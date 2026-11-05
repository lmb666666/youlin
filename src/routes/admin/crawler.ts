import { Hono, type Context } from 'hono'
import { jsonError, readJson } from '../../util/http'
import { isoUtc } from '../../util/time'
import { loadConfig } from '../../config/loader'
import { readRoundState, roundStatus, runManualRound, runHealthRound } from '../../crawler/crawl'
import { extractDeclaredFeeds, commonFeedPaths } from '../../crawler/discover'
import { fetchRemote } from '../../crawler/http'
import { parseFeed } from '../../crawler/parse'
import type { AppConfig, AppEnv } from '../../types'
import { runInBackground } from '../../util/bg'
import {
  countActiveFriends,
  countDueFriends,
  deleteArticle,
  findActiveFriend,
  findFriendBrief,
  listAdminArticles,
  listHealthSources,
} from '../../repositories/crawl'

/**
 * 抓取/体检/文章的管理 API（DESIGN §5）：
 *   GET  /api/admin/health           体检列表（全字段 source_state）
 *   POST /api/admin/health/run       全量体检（三路 + 反链，后台并发）
 *   GET  /api/admin/articles         文章列表（可按源筛）
 *   DELETE /api/admin/articles/:id
 *   POST /api/admin/crawl            手动全量抓取一轮（后台并发）
 *   POST /api/admin/crawl/:friendId  单源手动抓取（同步）
 *   GET  /api/admin/crawl/status     轮转进度
 *   POST /api/admin/friends/:id/probe    自动探测（已保存的友链）
 *   POST /api/admin/friends/probe        自动探测（表单预保存：body { link, feed? }）
 */

interface ProbeResult {
  feed?: string
  title?: string
  icon?: string
  avatar?: string
}

export function crawlerRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/health', async (c) => {
    const rows = listHealthSources(c.env.DB)
    return c.json({
      friends: rows.map(({ friend: f, state: s }) => ({
        id: f.id,
        author: f.author,
        title: f.title ?? undefined,
        link: f.link,
        feed: f.feed ?? undefined,
        inCircle: f.inCircle === 1,
        status: f.status,
        state:
          s?.checkedAt == null
            ? null
            : {
                reachable: s.reachable == null ? null : s.reachable === 1,
                crawlable: s.crawlable == null ? null : s.crawlable === 1,
                bestMethod: s.bestMethod ?? null,
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
    })
  })

  // 全量体检：waitUntil 后台跑（进度见 /crawl/status）
  app.post('/api/admin/health/run', async (c) => {
    const busy = await roundConflict(c)
    if (busy) return busy
    const { cfg } = await loadConfig(c.env.DB, c.env)
    if (!cfg.linkCheck.enabled) return jsonError(400, 'health_disabled', '体检总开关已关闭（linkCheck.enabled）')
    const n = countActiveFriends(c.env.DB)
    if (n === 0) return c.json({ started: 0 })
    runInBackground(c, runHealthRound(c.env.DB, c.env, cfg))
    return c.json({ started: n })
  })

  app.get('/api/admin/articles', async (c) => {
    const friendId = Number(c.req.query('friendId'))
    const filter = Number.isInteger(friendId) && friendId > 0
    const rows = listAdminArticles(c.env.DB, filter ? friendId : undefined)
    return c.json({
      articles: rows.map((r) => ({
        id: r.id,
        friendId: r.friendId,
        friendAuthor: r.friendAuthor,
        title: r.title,
        link: r.link,
        author: r.author ?? undefined,
        publishedAt: isoUtc(r.publishedAt),
        fetchedAt: isoUtc(r.fetchedAt),
      })),
    })
  })

  app.delete('/api/admin/articles/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    deleteArticle(c.env.DB, id)
    return c.json({ ok: true })
  })

  // 手动全量抓取一轮（后台并发，进度见 /status）
  app.post('/api/admin/crawl', async (c) => {
    const busy = await roundConflict(c)
    if (busy) return busy
    const { cfg } = await loadConfig(c.env.DB, c.env)
    if (!cfg.crawl.enabled && !cfg.linkCheck.enabled) {
      return jsonError(400, 'crawl_disabled', '抓取与体检总开关均已关闭')
    }
    const n = countActiveFriends(c.env.DB)
    if (n === 0) return c.json({ started: 0 })
    runInBackground(c, runManualRound(c.env.DB, c.env, cfg))
    return c.json({ started: n })
  })

  // 单源手动抓取（同步执行，返回该源结果）
  app.post('/api/admin/crawl/:friendId', async (c) => {
    const friendId = Number(c.req.param('friendId'))
    if (!Number.isInteger(friendId)) return jsonError(400, 'invalid_id', 'id 不合法')
    const friend = findActiveFriend(c.env.DB, friendId)
    if (!friend) return jsonError(404, 'not_found', '友链不存在或未启用')
    const { cfg } = await loadConfig(c.env.DB, c.env)
    if (!cfg.crawl.enabled && !cfg.linkCheck.enabled) {
      return jsonError(400, 'crawl_disabled', '抓取与体检总开关均已关闭')
    }
    const { crawlSource } = await import('../../crawler/crawl')
    const outcome = await crawlSource(c.env.DB, c.env, cfg, friend)
    return c.json({ outcome })
  })

  app.get('/api/admin/crawl/status', async (c) => {
    const round = await readRoundState(c.env.DB)
    const { running, stale } = roundStatus(round)
    return c.json({
      running,
      stale,
      round,
      activeCount: countActiveFriends(c.env.DB),
      dueCount: countDueFriends(c.env.DB),
    })
  })

  // 探测：表单预保存场景（body 直接给 link/feed，无需先存库）
  app.post('/api/admin/friends/probe', async (c) => {
    const body = await readJson(c)
    const input = body as { link?: unknown; feed?: unknown } | null
    const link = typeof input?.link === 'string' ? input.link.trim() : ''
    if (!/^https?:\/\//.test(link)) return jsonError(400, 'invalid_link', '请先填写合法的站点链接（http/https）')
    const feed = typeof input?.feed === 'string' && input.feed.trim() !== '' ? input.feed.trim() : null
    const { cfg } = await loadConfig(c.env.DB, c.env)
    const probe = await runProbe(c.env, cfg, { link, feed })
    if ('error' in probe) return jsonError(502, 'probe_unreachable', probe.error)
    return c.json({ probe })
  })

  // 探测：已保存的友链（DESIGN §5）
  app.post('/api/admin/friends/:id/probe', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const friend = findFriendBrief(c.env.DB, id)
    if (!friend) return jsonError(404, 'not_found', '友链不存在')
    const { cfg } = await loadConfig(c.env.DB, c.env)
    const probe = await runProbe(c.env, cfg, { link: friend.link, feed: friend.feed })
    if ('error' in probe) return jsonError(502, 'probe_unreachable', probe.error)
    return c.json({ probe })
  })

  return app
}

/** 手动轮转的单飞保护：未结束且未超时则拒绝新任务；stale 的旧记录允许覆盖 */
async function roundConflict(c: Context<AppEnv>): Promise<Response | null> {
  const round = await readRoundState(c.env.DB)
  if (!roundStatus(round).running) return null
  return jsonError(409, 'round_running', '已有抓取/体检任务进行中，请等待完成')
}

/** 自动探测：feed 发现（声明式 <link> 优先 + 常见路径）、站点标题、favicon、og:image */
export async function runProbe(
  env: AppEnv['Bindings'],
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
