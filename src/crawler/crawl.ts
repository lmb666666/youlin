import type { Env, AppConfig } from '../types'
import { parseFeed, withResolvedGuids } from './parse'
import { fetchRemote, nextIntervalHours, runtimeGet, runtimeSet } from './http'
import { checkFriendHealth, persistHealth, refreshBacklink, type PriorState } from './linkcheck'
import { dbTime, daysSince } from '../util/time'
import { runPool } from '../util/pool'

/**
 * 抓取器（DESIGN §6）：Workers 免费版 10ms CPU → 分批轮转，绝不一次全量。
 * 单源流程：条件请求（ETag/Last-Modified）→ 304 只更新状态 → 200 解析增量 upsert；
 * RSS 失败时落到完整体检分支（首页兜底 / feed 发现 / 反链），避免 "feed 挂了误报整站失联"。
 */

export interface FriendRow {
  id: number
  author: string
  link: string
  feed: string | null
  in_circle: number
}

export interface CrawlSummary {
  total: number
  ok: number
  notModified: number
  failed: number
  skipped: number
}

type Outcome = 'ok' | 'notModified' | 'failed' | 'skipped'
type RssAttempt = { outcome: 'ok' | 'notModified' } | { outcome: 'failed'; error: string }

const DB_NOW = "datetime('now')"

export async function ensureStateRow(db: Env['DB'], friendId: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO source_state (friend_id) VALUES (?)').bind(friendId).run()
}

async function loadCrawlState(db: Env['DB'], friendId: number): Promise<{ etag: string | null; last_modified: string | null } | null> {
  return (
    (await db
      .prepare('SELECT etag, last_modified FROM source_state WHERE friend_id = ?')
      .bind(friendId)
      .first<{ etag: string | null; last_modified: string | null }>()) ?? null
  )
}

async function loadPriorState(db: Env['DB'], friendId: number): Promise<PriorState | null> {
  return (
    (await db
      .prepare('SELECT unreachable_since, rss_unavailable_since, fail_count FROM source_state WHERE friend_id = ?')
      .bind(friendId)
      .first<PriorState>()) ?? null
  )
}

/** 选取本轮该抓的源：active 且 next_check_at 到期，最久未检查优先 */
export async function selectDueSources(db: Env['DB'], limit: number): Promise<FriendRow[]> {
  const rows = await db
    .prepare(
      `SELECT f.id, f.author, f.link, f.feed, f.in_circle
         FROM friends f
         LEFT JOIN source_state s ON s.friend_id = f.id
        WHERE f.status = 'active'
          AND (s.next_check_at IS NULL OR s.next_check_at <= ${DB_NOW})
        ORDER BY s.checked_at ASC, f.id ASC
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; author: string; link: string; feed: string | null; in_circle: number }>()
  return rows.results.map((f) => ({ id: f.id, author: f.author, link: f.link, feed: f.feed, in_circle: f.in_circle }))
}

export async function listActiveFriends(db: Env['DB']): Promise<FriendRow[]> {
  const rows = await db
    .prepare("SELECT id, author, link, feed, in_circle FROM friends WHERE status = 'active' ORDER BY id")
    .all<{ id: number; author: string; link: string; feed: string | null; in_circle: number }>()
  return rows.results.map((f) => ({ id: f.id, author: f.author, link: f.link, feed: f.feed, in_circle: f.in_circle }))
}

/** Cron 一轮：取 batchSize 个到期源逐个处理 + 每日清理 */
export async function runCronTick(db: Env['DB'], env: Env, cfg: AppConfig): Promise<CrawlSummary> {
  const sources = await selectDueSources(db, cfg.crawl.batchSize)
  const summary: CrawlSummary = { total: sources.length, ok: 0, notModified: 0, failed: 0, skipped: 0 }
  for (const friend of sources) {
    try {
      summary[await crawlSource(db, env, cfg, friend)]++
    } catch (e) {
      console.error(`[crawl] friend ${friend.id} unhandled:`, e)
      summary.failed++
    }
  }
  await dailyCleanup(db, cfg)
  return summary
}

/** 手动全量抓取一轮（所有 active 源，并发受限；进度写 internal.round） */
export async function runManualRound(db: Env['DB'], env: Env, cfg: AppConfig): Promise<void> {
  const sources = await listActiveFriends(db)
  const startedAt = new Date().toISOString()
  let done = 0
  // 进度写节流：每 10% 或完成时才写，避免大列表的写放大
  const step = Math.max(1, Math.ceil(sources.length / 10))
  await runtimeSet(db, 'internal.round', { kind: 'crawl', startedAt, done: 0, total: sources.length })
  await runPool(sources, cfg.crawl.concurrency, async (friend) => {
    try {
      await crawlSource(db, env, cfg, friend)
    } catch (e) {
      console.error(`[crawl] friend ${friend.id} unhandled:`, e)
    }
    done++
    if (done === sources.length || done % step === 0) {
      await runtimeSet(db, 'internal.round', { kind: 'crawl', startedAt, done, total: sources.length })
    }
  })
}

/** 手动全量体检（三路 + 反链） */
export async function runHealthRound(db: Env['DB'], env: Env, cfg: AppConfig): Promise<void> {
  const sources = await listActiveFriends(db)
  if (sources.length === 0) return
  const startedAt = new Date().toISOString()
  let done = 0
  const step = Math.max(1, Math.ceil(sources.length / 10))
  await runtimeSet(db, 'internal.round', { kind: 'health', startedAt, done: 0, total: sources.length })
  await runPool(sources, cfg.linkCheck.concurrency, async (friend) => {
    try {
      await healthDiagnosis(db, env, cfg, friend)
    } catch (e) {
      console.error(`[health] friend ${friend.id} unhandled:`, e)
    }
    done++
    if (done === sources.length || done % step === 0) {
      await runtimeSet(db, 'internal.round', { kind: 'health', startedAt, done, total: sources.length })
    }
  })
}

/**
 * 单源处理（Cron 与手动共用）：
 *   feed 非空且抓取开启 → RSS 条件抓取（成功/304 后顺带刷新反链）
 *   RSS 失败 → 完整体检诊断（首页可达？feed 迁走了？）——避免误报整站失联
 *   无 feed → 完整体检（含 feed 发现，发现即写回 friends.feed）
 */
export async function crawlSource(db: Env['DB'], env: Env, cfg: AppConfig, friend: FriendRow): Promise<Outcome> {
  await ensureStateRow(db, friend.id)

  if (friend.feed && cfg.crawl.enabled) {
    const attempt = await crawlRss(db, env, cfg, friend, await loadCrawlState(db, friend.id))
    if (attempt.outcome !== 'failed') {
      if (cfg.backlink.enabled) await refreshBacklink(db, env, cfg, friend)
      return attempt.outcome
    }
    if (cfg.linkCheck.enabled) return await healthDiagnosis(db, env, cfg, friend)
    // 体检关闭时无兜底手段：落一笔最简失败账，保证 next_check_at 前进
    await markCrawlFailure(db, cfg, friend.id, attempt.error)
    return 'failed'
  }

  if (!cfg.linkCheck.enabled) return 'skipped'
  return await healthDiagnosis(db, env, cfg, friend)
}

/** 完整体检单源：三路 + 反链 + 写回 + feed 发现自动落库 */
async function healthDiagnosis(db: Env['DB'], env: Env, cfg: AppConfig, friend: FriendRow): Promise<Outcome> {
  await ensureStateRow(db, friend.id)
  const prior = await loadPriorState(db, friend.id)
  const result = await checkFriendHealth(env, cfg, friend)
  await persistHealth(db, cfg, friend.id, result, prior)
  // 「未指定则自动探测」（PLAN §6.1）：仅在 feed 为空时写回，不覆盖人工配置
  if (!friend.feed && result.discoveredFeed) {
    await db
      .prepare("UPDATE friends SET feed = ?, updated_at = datetime('now') WHERE id = ? AND feed IS NULL")
      .bind(result.discoveredFeed, friend.id)
      .run()
  }
  return result.reachable ? 'ok' : 'failed'
}

// ── RSS 抓取 ──────────────────────────────────────────────────────────────

async function crawlRss(
  db: Env['DB'],
  env: Env,
  cfg: AppConfig,
  friend: FriendRow,
  state: { etag: string | null; last_modified: string | null } | null,
): Promise<RssAttempt> {
  const headers: Record<string, string> = {}
  if (state?.etag) headers['If-None-Match'] = state.etag
  if (state?.last_modified) headers['If-Modified-Since'] = state.last_modified

  const res = await fetchRemote(env, {
    url: friend.feed!,
    cfg,
    timeoutSeconds: cfg.crawl.timeoutSeconds,
    headers,
  })

  if (res.status === 304) {
    const base = Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))
    await db
      .prepare(
        `UPDATE source_state SET reachable = 1, crawlable = 1, best_method = 'rss', fail_count = 0,
                unreachable_since = NULL, rss_unavailable_since = NULL, last_ok_at = ${DB_NOW},
                checked_at = ${DB_NOW}, next_check_at = datetime('now', ?), latency_ms = ?
          WHERE friend_id = ?`,
      )
      .bind(`+${base * 60} minutes`, res.latencyMs, friend.id)
      .run()
    return { outcome: 'notModified' }
  }

  if (res.error || res.status === 0) return { outcome: 'failed', error: res.error ?? 'network_error' }
  if (res.status >= 400) return { outcome: 'failed', error: `feed HTTP ${res.status}` }

  let entries
  try {
    entries = await withResolvedGuids(await parseFeed(res.body ?? ''))
  } catch (e) {
    return { outcome: 'failed', error: `parse: ${e instanceof Error ? e.message : e}` }
  }

  const now = Date.now()
  const toleranceMs = cfg.crawl.futureToleranceDays * 86_400_000
  const valid = entries
    .filter((e) => new Date(e.publishedAt).getTime() <= now + toleranceMs)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))

  if (friend.in_circle === 1) {
    for (const e of valid.slice(0, cfg.crawl.maxPerFriend)) {
      await db
        .prepare(
          `INSERT INTO articles (friend_id, guid, title, link, author, published_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(friend_id, guid) DO UPDATE SET
             title = excluded.title, link = excluded.link, author = excluded.author, published_at = excluded.published_at`,
        )
        .bind(friend.id, e.guid, e.title, e.link, e.author, e.publishedAt)
        .run()
    }
    await db
      .prepare(
        `DELETE FROM articles WHERE friend_id = ? AND id NOT IN (
           SELECT id FROM articles WHERE friend_id = ? ORDER BY published_at DESC, id DESC LIMIT ?)`,
      )
      .bind(friend.id, friend.id, cfg.crawl.maxPerFriend)
      .run()
  }

  const lastPost = valid[0]?.publishedAt ?? null
  const lastPostDays = lastPost ? Math.max(0, Math.floor((now - new Date(lastPost).getTime()) / 86_400_000)) : null
  const base = Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))

  await db
    .prepare(
      `UPDATE source_state SET reachable = 1, crawlable = 1, best_method = 'rss', http_status = ?, latency_ms = ?,
              final_url = ?, etag = ?, last_modified = ?, rss_unavailable_since = NULL,
              last_post_published = COALESCE(?, last_post_published),
              last_post_days_ago = COALESCE(?, last_post_days_ago),
              last_ok_at = ${DB_NOW}, last_error = NULL, fail_count = 0, unreachable_since = NULL,
              checked_at = ${DB_NOW}, next_check_at = datetime('now', ?)
        WHERE friend_id = ?`,
    )
    .bind(
      res.status, res.latencyMs, res.finalUrl, res.headers.get('etag'), res.headers.get('last-modified'),
      lastPost ? dbTime(lastPost) : null, lastPostDays,
      `+${base * 60} minutes`, friend.id,
    )
    .run()
  return { outcome: 'ok' }
}

/** 体检关闭时的最简失败落账（无法确认站点可达性，按失联处理并退避） */
async function markCrawlFailure(db: Env['DB'], cfg: AppConfig, friendId: number, error: string): Promise<void> {
  const row = await db
    .prepare('SELECT unreachable_since FROM source_state WHERE friend_id = ?')
    .bind(friendId)
    .first<{ unreachable_since: string | null }>()
  const unreachableDays = daysSince(row?.unreachable_since) ?? 0
  const base = Math.round(nextIntervalHours(unreachableDays, cfg, cfg.linkCheck.maxAgeHours))
  await db
    .prepare(
      `UPDATE source_state SET reachable = 0, crawlable = 0, last_error = ?, fail_count = fail_count + 1,
              unreachable_since = COALESCE(unreachable_since, ${DB_NOW}), checked_at = ${DB_NOW},
              next_check_at = datetime('now', ?)
        WHERE friend_id = ?`,
    )
    .bind(error, `+${base * 60} minutes`, friendId)
    .run()
}

// ── 清理 ─────────────────────────────────────────────────────────────────

/** 每天一次：清理超出 retentionDays 的文章（articles.published_at 存 ISO 8601） */
export async function dailyCleanup(db: Env['DB'], cfg: AppConfig): Promise<void> {
  const last = (await runtimeGet(db, 'internal.lastCleanupAt')) as string | null
  const now = new Date()
  if (last && now.getTime() - new Date(last).getTime() < 24 * 3_600_000) return
  const cutoff = new Date(now.getTime() - cfg.crawl.retentionDays * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z')
  await db.prepare('DELETE FROM articles WHERE published_at < ?').bind(cutoff).run()
  await runtimeSet(db, 'internal.lastCleanupAt', now.toISOString())
}
