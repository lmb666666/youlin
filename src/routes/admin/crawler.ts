import { Hono, type Context } from 'hono'
import { jsonError, readJson } from '../../util/http'
import { isoUtc } from '../../util/time'
import { loadConfig } from '../../config/loader'
import { runManualRound, runHealthRound } from '../../crawler/crawl'
import { extractDeclaredFeeds, commonFeedPaths } from '../../crawler/discover'
import { fetchRemote, runtimeGet } from '../../crawler/http'
import { parseFeed } from '../../crawler/parse'
import type { AppConfig, AppEnv } from '../../types'

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

interface FriendBrief {
  id: number
  author: string
  link: string
  feed: string | null
}

interface ProbeResult {
  feed?: string
  title?: string
  icon?: string
  avatar?: string
}

export function crawlerRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/health', async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT f.id, f.author, f.title, f.link, f.feed, f.in_circle, f.status, s.*
         FROM friends f LEFT JOIN source_state s ON s.friend_id = f.id
        ORDER BY CASE WHEN s.reachable = 0 THEN 0 ELSE 1 END, s.next_check_at ASC, f.id ASC`,
    ).all<Record<string, unknown>>()
    return c.json({
      friends: rows.results.map((r) => ({
        id: r.id,
        author: r.author,
        title: r.title ?? undefined,
        link: r.link,
        feed: r.feed ?? undefined,
        inCircle: r.in_circle === 1,
        status: r.status,
        state:
          r.checked_at == null
            ? null
            : {
                reachable: r.reachable == null ? null : r.reachable === 1,
                crawlable: r.crawlable == null ? null : r.crawlable === 1,
                bestMethod: r.best_method ?? null,
                httpStatus: r.http_status ?? null,
                latencyMs: r.latency_ms ?? null,
                finalUrl: r.final_url ?? null,
                backlinkChecked: r.backlink_checked === 1,
                backlink: r.backlink_checked === 1 ? r.backlink === 1 : null,
                unreachableSince: isoUtc(r.unreachable_since as string) ?? null,
                rssUnavailableSince: isoUtc(r.rss_unavailable_since as string) ?? null,
                lastPostPublished: isoUtc(r.last_post_published as string) ?? null,
                lastPostDaysAgo: r.last_post_days_ago ?? null,
                lastOkAt: isoUtc(r.last_ok_at as string) ?? null,
                lastError: r.last_error ?? null,
                failCount: r.fail_count ?? 0,
                nextCheckAt: isoUtc(r.next_check_at as string) ?? null,
                checkedAt: isoUtc(r.checked_at as string) ?? null,
              },
      })),
    })
  })

  // 全量体检：waitUntil 后台跑（进度见 /crawl/status）
  app.post('/api/admin/health/run', async (c) => {
    const { cfg } = await loadConfig(c.env.DB, c.env)
    if (!cfg.linkCheck.enabled) return jsonError(400, 'health_disabled', '体检总开关已关闭（linkCheck.enabled）')
    const n = await countActive(c)
    if (n === 0) return c.json({ started: 0 })
    c.executionCtx.waitUntil(runHealthRound(c.env.DB, c.env, cfg))
    return c.json({ started: n })
  })

  app.get('/api/admin/articles', async (c) => {
    const friendId = Number(c.req.query('friendId'))
    const filter = Number.isInteger(friendId) && friendId > 0
    const stmt = c.env.DB.prepare(
      `SELECT a.id, a.friend_id, f.author AS friend_author, a.title, a.link, a.author, a.published_at, a.fetched_at
         FROM articles a JOIN friends f ON f.id = a.friend_id
         ${filter ? 'WHERE a.friend_id = ?' : ''}
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT 200`,
    )
    const rows = filter
      ? await stmt.bind(friendId).all<Record<string, unknown>>()
      : await stmt.all<Record<string, unknown>>()
    return c.json({
      articles: rows.results.map((r) => ({
        id: r.id,
        friendId: r.friend_id,
        friendAuthor: r.friend_author,
        title: r.title,
        link: r.link,
        author: r.author ?? undefined,
        publishedAt: isoUtc(r.published_at as string),
        fetchedAt: isoUtc(r.fetched_at as string),
      })),
    })
  })

  app.delete('/api/admin/articles/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    await c.env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(id).run()
    return c.json({ ok: true })
  })

  // 手动全量抓取一轮（后台并发，进度见 /status）
  app.post('/api/admin/crawl', async (c) => {
    const { cfg } = await loadConfig(c.env.DB, c.env)
    if (!cfg.crawl.enabled && !cfg.linkCheck.enabled) {
      return jsonError(400, 'crawl_disabled', '抓取与体检总开关均已关闭')
    }
    const n = await countActive(c)
    if (n === 0) return c.json({ started: 0 })
    c.executionCtx.waitUntil(runManualRound(c.env.DB, c.env, cfg))
    return c.json({ started: n })
  })

  // 单源手动抓取（同步执行，返回该源结果）
  app.post('/api/admin/crawl/:friendId', async (c) => {
    const friendId = Number(c.req.param('friendId'))
    if (!Number.isInteger(friendId)) return jsonError(400, 'invalid_id', 'id 不合法')
    const friend = await c.env.DB.prepare('SELECT id, author, link, feed, in_circle FROM friends WHERE id = ? AND status = ?')
      .bind(friendId, 'active')
      .first<FriendBrief & { in_circle: number }>()
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
    const round = (await runtimeGet(c.env.DB, 'internal.round')) as
      | { kind: string; startedAt: string; done: number; total: number }
      | null
    const counts = await c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM friends WHERE status = 'active') AS active_count,
         (SELECT COUNT(*) FROM friends f LEFT JOIN source_state s ON s.friend_id = f.id
            WHERE f.status = 'active' AND (s.next_check_at IS NULL OR s.next_check_at <= datetime('now'))) AS due_count`,
    ).first<{ active_count: number; due_count: number }>()
    const running = round !== null && round.done < round.total
    return c.json({
      running,
      round,
      activeCount: counts?.active_count ?? 0,
      dueCount: counts?.due_count ?? 0,
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
    const friend = await c.env.DB.prepare('SELECT id, author, link, feed FROM friends WHERE id = ?')
      .bind(id)
      .first<FriendBrief>()
    if (!friend) return jsonError(404, 'not_found', '友链不存在')
    const { cfg } = await loadConfig(c.env.DB, c.env)
    const probe = await runProbe(c.env, cfg, { link: friend.link, feed: friend.feed })
    if ('error' in probe) return jsonError(502, 'probe_unreachable', probe.error)
    return c.json({ probe })
  })

  return app
}

async function countActive(c: Context<AppEnv>): Promise<number> {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE status = 'active'").first<{ n: number }>()
  return row?.n ?? 0
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
