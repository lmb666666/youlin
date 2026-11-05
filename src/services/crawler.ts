import { randomUUID } from 'node:crypto'
import { AppError } from '../errors'
import { isoUtc } from '../util/time'
import { runDetached } from '../util/bg'
import { logger } from '../log'
import { acquireLock, releaseLock, renewLock } from '../repositories/locks'
import { SCHEDULER_LOCK_KEY, SCHEDULER_LOCK_RENEW_MS, SCHEDULER_LOCK_TTL_MS } from '../server/scheduler-lock'
import { readRoundState, roundStatus, runHealthRound, runManualRound } from '../crawler/crawl'
import { extractDeclaredFeeds, commonFeedPaths } from '../crawler/discover'
import { fetchRemote } from '../crawler/http'
import { parseFeed } from '../crawler/parse'
import {
  countActiveFriends,
  countDueFriends,
  deleteArticle as removeArticle,
  findActiveFriend,
  findFriendBrief,
  listAdminArticles,
  listHealthSources,
} from '../repositories/crawl'
import type { AppConfig, Db, Env } from '../types'
import type { ArticleListResponse, CrawlStatus, HealthListResponse, ProbeResult } from '@youlin/contracts'

export function listHealthView(db: Db): HealthListResponse {
  return {
    friends: listHealthSources(db).map(({ friend: f, state: s }) => ({
      id: f.id,
      author: f.author,
      title: f.title ?? undefined,
      link: f.link,
      feed: f.feed ?? undefined,
      inCircle: f.inCircle === 1,
      status: f.status === 'hidden' ? 'hidden' : 'active',
      state:
        s?.checkedAt == null
          ? null
          : {
              reachable: s.reachable == null ? null : s.reachable === 1,
              crawlable: s.crawlable == null ? null : s.crawlable === 1,
              bestMethod: s.bestMethod === 'rss' || s.bestMethod === 'homepage' || s.bestMethod === 'api' || s.bestMethod === 'none' ? s.bestMethod : null,
              httpStatus: s.httpStatus ?? null,
              latencyMs: s.latencyMs ?? null,
              finalUrl: s.finalUrl ?? null,
              backlinkChecked: s.backlinkChecked === 1,
              backlink: s.backlinkChecked === 1 ? (s.backlink === null ? null : s.backlink === 1) : null,
              unreachableSince: isoUtc(s.unreachableSince) ?? null,
              rssUnavailableSince: isoUtc(s.rssUnavailableSince) ?? null,
              lastPostPublished: isoUtc(s.lastPostPublished) ?? null,
              lastPostDaysAgo: s.lastPostDaysAgo ?? null,
              lastOkAt: isoUtc(s.lastOkAt) ?? null,
              lastError: s.lastError ?? null,
              failCount: s.failCount ?? 0,
              nextCheckAt: isoUtc(s.nextCheckAt) ?? null,
              checkedAt: isoUtc(s.checkedAt) ?? null,
            },
    })),
  }
}

export function listArticlesView(db: Db, friendId?: number): ArticleListResponse {
  return {
    articles: listAdminArticles(db, friendId).map((r) => ({
      id: r.id,
      friendId: r.friendId,
      friendAuthor: r.friendAuthor,
      title: r.title,
      link: r.link,
      author: r.author ?? undefined,
      publishedAt: isoUtc(r.publishedAt),
      fetchedAt: isoUtc(r.fetchedAt),
    })),
  }
}

export function deleteArticle(db: Db, id: number): void {
  removeArticle(db, id)
}

export async function crawlStatus(db: Db): Promise<CrawlStatus> {
  const round = await readRoundState(db)
  const { running, stale } = roundStatus(round)
  return {
    running,
    stale,
    round,
    activeCount: countActiveFriends(db),
    dueCount: countDueFriends(db),
  }
}

async function launchRound(db: Db, task: () => Promise<void>): Promise<void> {
  const owner = randomUUID()
  if (!(await acquireLock(db, SCHEDULER_LOCK_KEY, owner, SCHEDULER_LOCK_TTL_MS))) {
    throw new AppError(409, 'round_running', '已有抓取/体检任务进行中，请等待完成')
  }
  const heartbeat = setInterval(() => {
    void renewLock(db, SCHEDULER_LOCK_KEY, owner, SCHEDULER_LOCK_TTL_MS)
      .then((ok) => {
        if (!ok) logger.warn({ owner }, 'manual round lock lost')
      })
      .catch((err) => logger.warn({ err }, 'manual round lock renew failed'))
  }, SCHEDULER_LOCK_RENEW_MS)

  runDetached(
    task().finally(async () => {
      clearInterval(heartbeat)
      await releaseLock(db, SCHEDULER_LOCK_KEY, owner).catch((err) => {
        logger.warn({ err }, 'manual round lock release failed')
      })
    }),
  )
}

async function ensureNoRound(db: Db): Promise<void> {
  const round = await readRoundState(db)
  if (roundStatus(round).running) {
    throw new AppError(409, 'round_running', '已有抓取/体检任务进行中，请等待完成')
  }
}

/** 启动全量体检；返回本次覆盖的源数量，0 表示没有可检查的源 */
export async function startHealthRound(db: Db, env: Env, cfg: AppConfig): Promise<number> {
  await ensureNoRound(db)
  if (!cfg.linkCheck.enabled) throw new AppError(400, 'health_disabled', '体检总开关已关闭（linkCheck.enabled）')
  const n = countActiveFriends(db)
  if (n > 0) await launchRound(db, () => runHealthRound(db, env, cfg))
  return n
}

/** 启动手动全量抓取；返回本次覆盖的源数量 */
export async function startCrawlRound(db: Db, env: Env, cfg: AppConfig): Promise<number> {
  await ensureNoRound(db)
  if (!cfg.crawl.enabled && !cfg.linkCheck.enabled) {
    throw new AppError(400, 'crawl_disabled', '抓取与体检总开关均已关闭')
  }
  const n = countActiveFriends(db)
  if (n > 0) await launchRound(db, () => runManualRound(db, env, cfg))
  return n
}

export async function crawlFriend(db: Db, env: Env, cfg: AppConfig, id: number): Promise<string> {
  const friend = findActiveFriend(db, id)
  if (!friend) throw new AppError(404, 'not_found', '友链不存在或未启用')
  if (!cfg.crawl.enabled && !cfg.linkCheck.enabled) {
    throw new AppError(400, 'crawl_disabled', '抓取与体检总开关均已关闭')
  }
  const { crawlSource } = await import('../crawler/crawl')
  return crawlSource(db, env, cfg, friend)
}

export async function probeInput(env: Env, cfg: AppConfig, raw: unknown): Promise<ProbeResult> {
  const input = raw as { link?: unknown; feed?: unknown } | null
  const link = typeof input?.link === 'string' ? input.link.trim() : ''
  if (!/^https?:\/\//.test(link)) throw new AppError(400, 'invalid_link', '请先填写合法的站点链接（http/https）')
  const feed = typeof input?.feed === 'string' && input.feed.trim() !== '' ? input.feed.trim() : null
  const probe = await runProbe(env, cfg, { link, feed })
  if ('error' in probe) throw new AppError(502, 'probe_unreachable', probe.error)
  return probe
}

export async function probeFriend(env: Env, cfg: AppConfig, db: Db, id: number): Promise<ProbeResult> {
  const friend = findFriendBrief(db, id)
  if (!friend) throw new AppError(404, 'not_found', '友链不存在')
  const probe = await runProbe(env, cfg, { link: friend.link, feed: friend.feed })
  if ('error' in probe) throw new AppError(502, 'probe_unreachable', probe.error)
  return probe
}

/** 自动探测：feed 发现（声明式 <link> 优先 + 常见路径）、站点标题、favicon、og:image */
export async function runProbe(
  env: Env,
  cfg: AppConfig,
  input: { link: string; feed: string | null },
): Promise<ProbeResult | { error: string }> {
  const home = await fetchRemote(env, { url: input.link, cfg, timeoutSeconds: cfg.crawl.timeoutSeconds })
  if (home.error || home.status >= 400 || home.body === null) {
    return { error: home.error ?? `站点不可达（HTTP ${home.status}）` }
  }

  const out: ProbeResult = {}

  // feed：已有可用 feed 则不重复发现；缺失或不可用时尝试发现
  let needDiscovery = input.feed === null
  if (input.feed) {
    const res = await fetchRemote(env, { url: input.feed, cfg, timeoutSeconds: cfg.crawl.timeoutSeconds })
    if (res.error || res.status !== 200) {
      needDiscovery = true
    } else {
      try {
        await parseFeed(res.body ?? '')
      } catch {
        needDiscovery = true
      }
    }
  }
  if (needDiscovery) {
    const declared = extractDeclaredFeeds(home.body, home.finalUrl)
    const candidates = [...declared, ...commonFeedPaths(input.link)].filter((c) => c !== input.feed).slice(0, 5)
    for (const candidate of candidates) {
      const res = await fetchRemote(env, { url: candidate, cfg, timeoutSeconds: cfg.crawl.timeoutSeconds })
      if (res.error || res.status !== 200) continue
      try {
        await parseFeed(res.body ?? '')
        out.feed = candidate
        break
      } catch { /* 下一个候选 */ }
    }
  }

  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(home.body)?.[1]?.trim()
  const ogSite = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,300})["']/i.exec(home.body)?.[1]
  if (ogSite || title) out.title = (ogSite ?? title)!

  const iconHref = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i.exec(home.body)?.[0]
  const iconUrl = iconHref ? /\bhref\s*=\s*["']([^"']+)["']/i.exec(iconHref)?.[1] : undefined
  if (iconUrl) {
    try {
      out.icon = new URL(iconUrl, home.finalUrl).toString()
    } catch { /* 忽略非法 */ }
  } else {
    try {
      const favicon = new URL('/favicon.ico', home.finalUrl).toString()
      const res = await fetchRemote(env, { url: favicon, cfg, timeoutSeconds: Math.min(5, cfg.crawl.timeoutSeconds) })
      if (res.status < 400) out.icon = favicon
    } catch { /* 忽略 */ }
  }

  const ogImage =
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']{1,1000})["']/i.exec(home.body)?.[1] ??
    /<meta[^>]+content=["']([^"']{1,1000})["'][^>]+property=["']og:image["']/i.exec(home.body)?.[1]
  if (ogImage) {
    try {
      out.avatar = new URL(ogImage, home.finalUrl).toString()
    } catch { /* 忽略非法 */ }
  }

  return out
}
