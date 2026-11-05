import type { Env, AppConfig } from '../types'
import { parseFeed, withResolvedGuids } from './parse'
import { fetchRemote, nextIntervalHours, runtimeGet, runtimeSet } from './http'
import { checkFriendHealth, persistHealth, refreshBacklink } from './linkcheck'
import { dbTime, daysSince } from '../util/time'
import { clampText } from '../util/str'
import { runPool } from '../util/pool'
import {
  deleteOldArticles,
  ensureStateRow,
  findCrawlState,
  findPriorCrawlState,
  findUnreachableSince,
  listActiveFriends,
  markCrawlFailure as markFailureState,
  markNotModified,
  markRssSuccess,
  replaceFriendArticles,
  selectDueSources,
  updateDiscoveredFeed,
} from '../repositories/crawl'

/**
 * 抓取器（DESIGN §6）：分批轮转，降低单次抓取压力，绝不在一个 tick 全量抓取。
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

/** Cron 一轮：取 batchSize 个到期源逐个处理 + 每日清理 */
export async function runCronTick(db: Env['DB'], env: Env, cfg: AppConfig): Promise<CrawlSummary> {
  const sources = selectDueSources(db, cfg.crawl.batchSize)
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

/** 手动轮转的最长存活时间；进程被截断后据此解除“进行中”状态 */
export const MAX_ROUND_MS = 10 * 60_000

export interface RoundState {
  kind: string
  startedAt: string
  done: number
  total: number
  finishedAt?: string
}

/** 读取 internal.round；结构不合法时视为没有进行中的轮转 */
export async function readRoundState(db: Env['DB']): Promise<RoundState | null> {
  const raw = await runtimeGet(db, 'internal.round')
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.kind !== 'string' || typeof o.startedAt !== 'string') return null
  if (typeof o.done !== 'number' || typeof o.total !== 'number') return null
  return {
    kind: o.kind,
    startedAt: o.startedAt,
    done: o.done,
    total: o.total,
    ...(typeof o.finishedAt === 'string' ? { finishedAt: o.finishedAt } : {}),
  }
}

/** running 只在“未结束、未完成、未超时”时成立；stale 供 UI 判断是否需要重新开始 */
export function roundStatus(round: RoundState | null, now = Date.now()): { running: boolean; stale: boolean } {
  if (!round) return { running: false, stale: false }
  const started = Date.parse(round.startedAt)
  const stale = !round.finishedAt && (!Number.isFinite(started) || now - started > MAX_ROUND_MS)
  const running = !round.finishedAt && round.done < round.total && !stale
  return { running, stale }
}

async function runRound(
  db: Env['DB'],
  kind: 'crawl' | 'health',
  sources: FriendRow[],
  concurrency: number,
  task: (friend: FriendRow) => Promise<void>,
): Promise<void> {
  const startedAt = new Date().toISOString()
  let done = 0
  // 进度写节流：每 10% 或完成时才写，避免大列表的写放大
  const step = Math.max(1, Math.ceil(sources.length / 10))
  await runtimeSet(db, 'internal.round', { kind, startedAt, done: 0, total: sources.length })
  try {
    await runPool(sources, concurrency, async (friend) => {
      try {
        await task(friend)
      } catch (e) {
        console.error(`[${kind}] friend ${friend.id} unhandled:`, e)
      }
      done++
      if (done === sources.length || done % step === 0) {
        await runtimeSet(db, 'internal.round', { kind, startedAt, done, total: sources.length })
      }
    })
  } finally {
    // 正常完成、异常退出都写结束标记；进程被直接杀掉时靠 MAX_ROUND_MS 判定 stale
    await runtimeSet(db, 'internal.round', {
      kind, startedAt, done, total: sources.length,
      finishedAt: new Date().toISOString(),
    })
  }
}

/** 手动全量抓取一轮（所有 active 源，并发受限；进度写 internal.round） */
export async function runManualRound(db: Env['DB'], env: Env, cfg: AppConfig): Promise<void> {
  const sources = listActiveFriends(db)
  await runRound(db, 'crawl', sources, cfg.crawl.concurrency, async (friend) => {
    await crawlSource(db, env, cfg, friend)
  })
}

/** 手动全量体检（三路 + 反链） */
export async function runHealthRound(db: Env['DB'], env: Env, cfg: AppConfig): Promise<void> {
  const sources = listActiveFriends(db)
  if (sources.length === 0) return
  await runRound(db, 'health', sources, cfg.linkCheck.concurrency, async (friend) => {
    await healthDiagnosis(db, env, cfg, friend)
  })
}

/**
 * 单源处理（Cron 与手动共用）：
 *   feed 非空且抓取开启 → RSS 条件抓取（成功/304 后顺带刷新反链）
 *   RSS 失败 → 完整体检诊断（首页可达？feed 迁走了？）——避免误报整站失联
 *   无 feed → 完整体检（含 feed 发现，发现即写回 friends.feed）
 */
export async function crawlSource(db: Env['DB'], env: Env, cfg: AppConfig, friend: FriendRow): Promise<Outcome> {
  ensureStateRow(db, friend.id)

  if (friend.feed && cfg.crawl.enabled) {
    const attempt = await crawlRss(db, env, cfg, friend, findCrawlState(db, friend.id))
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
  ensureStateRow(db, friend.id)
  const prior = findPriorCrawlState(db, friend.id)
  const result = await checkFriendHealth(env, cfg, friend)
  await persistHealth(db, cfg, friend.id, result, prior)
  // 「未指定则自动探测」（PLAN §6.1）：仅在 feed 为空时写回，不覆盖人工配置
  if (!friend.feed && result.discoveredFeed) {
    updateDiscoveredFeed(db, friend.id, result.discoveredFeed)
  }
  return result.reachable ? 'ok' : 'failed'
}

// ── RSS 抓取 ──────────────────────────────────────────────────────────────

async function crawlRss(
  db: Env['DB'],
  env: Env,
  cfg: AppConfig,
  friend: FriendRow,
  state: { etag: string | null; lastModified: string | null } | null,
): Promise<RssAttempt> {
  const headers: Record<string, string> = {}
  if (state?.etag) headers['If-None-Match'] = state.etag
  if (state?.lastModified) headers['If-Modified-Since'] = state.lastModified

  const res = await fetchRemote(env, {
    url: friend.feed!,
    cfg,
    timeoutSeconds: cfg.crawl.timeoutSeconds,
    headers,
  })

  if (res.status === 304) {
    const base = Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))
    markNotModified(db, friend.id, `+${base * 60} minutes`, res.latencyMs)
    return { outcome: 'notModified' }
  }

  if (res.error || res.status === 0) return { outcome: 'failed', error: res.error ?? 'network_error' }
  if (res.status >= 400) return { outcome: 'failed', error: `feed HTTP ${res.status}` }

  let entries
  try {
    entries = await withResolvedGuids(await parseFeed(res.body ?? '', res.finalUrl))
  } catch (e) {
    return { outcome: 'failed', error: `parse: ${e instanceof Error ? e.message : e}` }
  }

  const now = Date.now()
  const toleranceMs = cfg.crawl.futureToleranceDays * 86_400_000
  const valid = entries
    .filter((e) => new Date(e.publishedAt).getTime() <= now + toleranceMs)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))

  if (friend.in_circle === 1) {
    replaceFriendArticles(db, friend.id, valid.slice(0, cfg.crawl.maxPerFriend), cfg.crawl.maxPerFriend)
  }

  const lastPost = valid[0]?.publishedAt ?? null
  const lastPostDays = lastPost ? Math.max(0, Math.floor((now - new Date(lastPost).getTime()) / 86_400_000)) : null
  const base = Math.round(nextIntervalHours(null, cfg, cfg.linkCheck.maxAgeHours))

  markRssSuccess(db, friend.id, {
    httpStatus: res.status,
    latencyMs: res.latencyMs,
    finalUrl: res.finalUrl ? clampText(res.finalUrl, 2048) : null,
    etag: clampText(res.headers.get('etag'), 500),
    lastModified: clampText(res.headers.get('last-modified'), 100),
    lastPostPublished: lastPost ? dbTime(lastPost) : null,
    lastPostDaysAgo: lastPostDays,
    nextModifier: `+${base * 60} minutes`,
  })
  return { outcome: 'ok' }
}

/** 体检关闭时的最简失败落账（无法确认站点可达性，按失联处理并退避） */
async function markCrawlFailure(db: Env['DB'], cfg: AppConfig, friendId: number, error: string): Promise<void> {
  const unreachableDays = daysSince(findUnreachableSince(db, friendId)) ?? 0
  const base = Math.round(nextIntervalHours(unreachableDays, cfg, cfg.linkCheck.maxAgeHours))
  markFailureState(db, friendId, clampText(error, 2000), `+${base * 60} minutes`)
}

// ── 清理 ─────────────────────────────────────────────────────────────────

/** 每天一次：清理超出 retentionDays 的文章（用 datetime() 兼容历史空格格式） */
export async function dailyCleanup(db: Env['DB'], cfg: AppConfig): Promise<void> {
  const last = (await runtimeGet(db, 'internal.lastCleanupAt')) as string | null
  const now = new Date()
  if (last && now.getTime() - new Date(last).getTime() < 24 * 3_600_000) return
  const cutoff = new Date(now.getTime() - cfg.crawl.retentionDays * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z')
  deleteOldArticles(db, cutoff)
  await runtimeSet(db, 'internal.lastCleanupAt', now.toISOString())
}
