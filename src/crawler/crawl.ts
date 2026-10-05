import type { Env, AppConfig } from '../types'
import { parseFeed, withResolvedGuids } from './parse'
import { fetchRemote, nextIntervalHours, runtimeGet, runtimeSet } from './http'
import { daysSince } from '../util/time'

/**
 * 抓取器（DESIGN §6）：Workers 免费版 10ms CPU → 分批轮转，绝不一次全量。
 * 单源流程：条件请求（ETag/Last-Modified）→ 304 只更新状态 → 200 解析增量 upsert。
 */

export interface FriendRow {
  id: number
  author: string
  link: string
  feed: string | null
  in_circle: number
}

export interface StateRow {
  etag: string | null
  last_modified: string | null
  fail_count: number
  unreachable_since: string | null
}

interface CrawlSource {
  friend: FriendRow
  state: StateRow | null
}

async function loadState(db: Env['DB'], friendId: number): Promise<StateRow | null> {
  return (
    (await db
      .prepare('SELECT etag, last_modified, fail_count, unreachable_since FROM source_state WHERE friend_id = ?')
      .bind(friendId)
      .first<StateRow>()) ?? null
  )
}

export interface CrawlSummary {
  total: number
  ok: number
  notModified: number
  failed: number
  skipped: number
}

const ISO_NOW = "datetime('now')"

/** 选取本轮该抓的源：active 且 next_check_at 到期，最久未检查优先 */
export async function selectDueSources(db: Env['DB'], limit: number): Promise<FriendRow[]> {
  const friends = await db
    .prepare(
      `SELECT f.id, f.author, f.link, f.feed, f.in_circle
         FROM friends f
         LEFT JOIN source_state s ON s.friend_id = f.id
        WHERE f.status = 'active'
          AND (s.next_check_at IS NULL OR s.next_check_at <= ${ISO_NOW})
        ORDER BY s.checked_at ASC, f.id ASC
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: number; author: string; link: string; feed: string | null; in_circle: number }>()
  return friends.results.map((f) => ({ id: f.id, author: f.author, link: f.link, feed: f.feed, in_circle: f.in_circle }))
}

/** 一轮 Cron：取 batchSize 个到期源逐个处理（RSS 抓取或首页体检） */
export async function runCronTick(db: Env['DB'], env: Env, cfg: AppConfig): Promise<CrawlSummary> {
  const sources = await selectDueSources(db, cfg.crawl.batchSize)
  const summary: CrawlSummary = { total: sources.length, ok: 0, notModified: 0, failed: 0, skipped: 0 }
  for (const friend of sources) {
    try {
      const outcome = await crawlSource(db, env, cfg, friend)
      summary[outcome]++
    } catch (e) {
      console.error(`[crawl] friend ${friend.id} unhandled:`, e)
      summary.failed++
    }
  }
  await dailyCleanup(db, cfg)
  return summary
}

/** 手动全量：所有 active 源（并发受限），供 POST /api/admin/crawl 用 */
export async function runManualRound(db: Env['DB'], env: Env, cfg: AppConfig, kind: 'crawl' | 'health'): Promise<void> {
  const friends = await db
    .prepare('SELECT id, author, link, feed, in_circle FROM friends WHERE status = ? ORDER BY id')
    .bind('active')
    .all<{ id: number; author: string; link: string; feed: string | null; in_circle: number }>()
  const sources = friends.results.map((f) => ({ id: f.id, author: f.author, link: f.link, feed: f.feed, in_circle: f.in_circle }))

  const concurrency = kind === 'crawl' ? cfg.crawl.concurrency : cfg.linkCheck.concurrency
  let done = 0
  const startedAt = new Date().toISOString()
  await runtimeSet(db, 'internal.round', { kind, startedAt, done: 0, total: sources.length })

  const queue = [...sources]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const source = queue.shift()
      if (!source) return
      try {
        await crawlSource(db, env, cfg, source)
      } catch (e) {
        console.error(`[crawl] friend ${source.id} unhandled:`, e)
      }
      done++
      await runtimeSet(db, 'internal.round', { kind, startedAt, done, total: sources.length })
    }
  })
  await Promise.all(workers)
}

type Outcome = 'ok' | 'notModified' | 'failed' | 'skipped'

/** 单源处理：有 feed 走 RSS 抓取，无 feed 走首页体检（state 每次从库内取，保证条件请求生效） */
export async function crawlSource(db: Env['DB'], env: Env, cfg: AppConfig, friend: FriendRow): Promise<Outcome> {
  await ensureStateRow(db, friend.id)
  if (friend.feed) {
    if (!cfg.crawl.enabled && !cfg.linkCheck.enabled) return 'skipped'
    return crawlRss(db, env, cfg, friend, await loadState(db, friend.id))
  }
  if (!cfg.linkCheck.enabled) return 'skipped'
  await checkHomepageOnly(db, env, cfg, friend)
  return 'ok'
}

// ── RSS 抓取 ──────────────────────────────────────────────────────────────

async function crawlRss(db: Env['DB'], env: Env, cfg: AppConfig, friend: FriendRow, state: StateRow | null): Promise<Outcome> {
  const headers: Record<string, string> = {}
  if (state?.etag) headers['If-None-Match'] = state.etag
  if (state?.last_modified) headers['If-Modified-Since'] = state.last_modified

  const res = await fetchRemote(env, {
    url: friend.feed!,
    cfg,
    timeoutSeconds: cfg.crawl.timeoutSeconds,
    headers,
    proxyMode: 'fallback',
  })

  if (res.status === 304) {
    await db.prepare(
      `UPDATE source_state SET reachable = 1, crawlable = 1, best_method = 'rss', fail_count = 0,
              unreachable_since = NULL, last_ok_at = ${ISO_NOW}, checked_at = ${ISO_NOW},
              next_check_at = datetime('now', ?), latency_ms = ?
        WHERE friend_id = ?`,
    )
      .bind(`+${Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))} minutes`, res.latencyMs, friend.id)
      .run()
    return 'notModified'
  }

  if (res.error || res.status === 0) {
    await markUnreachable(db, cfg, friend.id, res.error ?? 'network_error')
    return 'failed'
  }

  if (res.status >= 400) {
    // 服务器可达但 feed 失效：可达性不受影响，RSS 标记不可用
    await db.prepare(
      `UPDATE source_state SET reachable = 1, crawlable = 0, http_status = ?, latency_ms = ?,
              rss_unavailable_since = COALESCE(rss_unavailable_since, ${ISO_NOW}),
              last_error = ?, fail_count = fail_count + 1, checked_at = ${ISO_NOW},
              next_check_at = datetime('now', ?), final_url = ?
        WHERE friend_id = ?`,
    )
      .bind(
        res.status, res.latencyMs, `feed HTTP ${res.status}`,
        `+${Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))} minutes`, res.finalUrl, friend.id,
      )
      .run()
    return 'failed'
  }

  // 200：解析 + 增量 upsert
  let entries
  try {
    const feed = await parseFeed(res.body ?? '')
    entries = await withResolvedGuids(feed)
  } catch (e) {
    await db.prepare(
      `UPDATE source_state SET reachable = 1, crawlable = 0, http_status = 200, latency_ms = ?,
              rss_unavailable_since = COALESCE(rss_unavailable_since, ${ISO_NOW}),
              last_error = ?, fail_count = fail_count + 1, checked_at = ${ISO_NOW},
              next_check_at = datetime('now', ?), final_url = ?
        WHERE friend_id = ?`,
    )
      .bind(
        res.latencyMs, `parse: ${e instanceof Error ? e.message : e}`,
        `+${Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))} minutes`, res.finalUrl, friend.id,
      )
      .run()
    return 'failed'
  }

  const now = Date.now()
  const toleranceMs = cfg.crawl.futureToleranceDays * 86_400_000
  const valid = entries
    .filter((e) => new Date(e.publishedAt).getTime() <= now + toleranceMs)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, friend.in_circle === 1 ? cfg.crawl.maxPerFriend : 0)

  if (friend.in_circle === 1) {
    for (const e of valid) {
      await db.prepare(
        `INSERT INTO articles (friend_id, guid, title, link, author, published_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(friend_id, guid) DO UPDATE SET
           title = excluded.title, link = excluded.link, author = excluded.author, published_at = excluded.published_at`,
      )
        .bind(friend.id, e.guid, e.title, e.link, e.author, e.publishedAt)
        .run()
    }
    // 只保留最新 maxPerFriend 条
    await db.prepare(
      `DELETE FROM articles WHERE friend_id = ? AND id NOT IN (
         SELECT id FROM articles WHERE friend_id = ? ORDER BY published_at DESC, id DESC LIMIT ?)`,
    )
      .bind(friend.id, friend.id, cfg.crawl.maxPerFriend)
      .run()
  }

  const lastPost = valid[0]?.publishedAt ?? null
  const lastPostDays = lastPost ? Math.max(0, Math.floor((now - new Date(lastPost).getTime()) / 86_400_000)) : null
  const etag = res.headers.get('etag')
  const lastModified = res.headers.get('last-modified')

  await db.prepare(
    `UPDATE source_state SET reachable = 1, crawlable = 1, best_method = 'rss', http_status = ?, latency_ms = ?,
            final_url = ?, etag = ?, last_modified = ?, rss_unavailable_since = NULL,
            last_post_published = COALESCE(?, last_post_published), last_post_days_ago = COALESCE(?, last_post_days_ago),
            last_ok_at = ${ISO_NOW}, last_error = NULL, fail_count = 0, unreachable_since = NULL,
            checked_at = ${ISO_NOW}, next_check_at = datetime('now', ?)
      WHERE friend_id = ?`,
  )
    .bind(
      res.status, res.latencyMs, res.finalUrl, etag, lastModified, lastPost, lastPostDays,
      `+${Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))} minutes`, friend.id,
    )
    .run()
  return 'ok'
}

async function markUnreachable(db: Env['DB'], cfg: AppConfig, friendId: number, error: string): Promise<void> {
  // 失联天数按既有 unreachable_since 计算，决定退避间隔
  const row = await db
    .prepare('SELECT unreachable_since, fail_count FROM source_state WHERE friend_id = ?')
    .bind(friendId)
    .first<{ unreachable_since: string | null; fail_count: number }>()
  const unreachableDays = daysSince(row?.unreachable_since) ?? 0
  await db.prepare(
    `UPDATE source_state SET reachable = 0, crawlable = 0, last_error = ?, fail_count = fail_count + 1,
            unreachable_since = COALESCE(unreachable_since, ${ISO_NOW}), checked_at = ${ISO_NOW},
            next_check_at = datetime('now', ?)
      WHERE friend_id = ?`,
  )
    .bind(error, `+${Math.round(nextIntervalHours(unreachableDays, cfg, cfg.linkCheck.maxAgeHours)) * 60} minutes`, friendId)
    .run()
}

async function ensureStateRow(db: Env['DB'], friendId: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO source_state (friend_id) VALUES (?)').bind(friendId).run()
}

/** 首页兜底体检（无 feed 的源）：可达即 reachable=1、crawlable=0 */
async function checkHomepageOnly(db: Env['DB'], env: Env, cfg: AppConfig, friend: FriendRow): Promise<void> {
  const res = await fetchRemote(env, { url: friend.link, cfg, timeoutSeconds: cfg.linkCheck.timeoutSeconds, proxyMode: 'fallback' })
  if (res.error || res.status === 0) {
    await markUnreachable(db, cfg, friend.id, res.error ?? 'network_error')
    return
  }
  await db.prepare(
    `UPDATE source_state SET reachable = 1, crawlable = 0, best_method = 'homepage', http_status = ?,
            latency_ms = ?, final_url = ?, last_ok_at = ${ISO_NOW}, last_error = NULL, fail_count = 0,
            unreachable_since = NULL, checked_at = ${ISO_NOW}, next_check_at = datetime('now', ?)
      WHERE friend_id = ?`,
  )
    .bind(res.status, res.latencyMs, res.finalUrl, `+${Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))} minutes`, friend.id)
    .run()
}

/** 每天一次：清理超出 retentionDays 的文章 */
export async function dailyCleanup(db: Env['DB'], cfg: AppConfig): Promise<void> {
  const last = (await runtimeGet(db, 'internal.lastCleanupAt')) as string | null
  const now = new Date()
  if (last && now.getTime() - new Date(last).getTime() < 24 * 3_600_000) return
  await db.prepare('DELETE FROM articles WHERE published_at < datetime(?, ?)').bind(
    now.toISOString().slice(0, 19).replace('T', ' '),
    `-${cfg.crawl.retentionDays} days`,
  ).run()
  await runtimeSet(db, 'internal.lastCleanupAt', now.toISOString())
}
