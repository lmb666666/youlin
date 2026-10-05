
import { Hono, type Context } from 'hono'
import { jsonError } from '../../util/http'
import { isoUtc } from '../../util/time'
import { loadConfig } from '../../config/loader'
import { runManualRound, type FriendRow } from '../../crawler/crawl'
import { checkFriendHealth, persistHealth } from '../../crawler/linkcheck'
import { runtimeGet, runtimeSet } from '../../crawler/http'
import { extractDeclaredFeeds, commonFeedPaths } from '../../crawler/discover'
import { fetchRemote } from '../../crawler/http'
import { parseFeed, withResolvedGuids } from '../../crawler/parse'
import type { AppConfig, AppEnv } from '../../types'

/**
 * 抓取/体检/文章的管理 API（DESIGN §5）：
 *   GET  /api/admin/health           体检列表（全字段 source_state）
 *   POST /api/admin/health/run       全量体检（三路 + 反链，后台并发）
 *   GET  /api/admin/articles         文章列表（可按源筛）
 *   DELETE /api/admin/articles/:id
 *   POST /api/admin/crawl            手动全量抓取一轮（后台并发）
 *   GET  /api/admin/crawl/status     轮转进度
 */

interface FullStateRow {
  friend_id: number
  reachable: number | null
  crawlable: number | null
  best_method: string | null
  http_status: number | null
  latency_ms: number | null
  final_url: string | null
  backlink_checked: number | null
  backlink: number | null
  unreachable_since: string | null
  rss_unavailable_since: string | null
  last_post_published: string | null
  last_post_days_ago: number | null
  last_ok_at: string | null
  last_error: string | null
  fail_count: number
  next_check_at: string | null
  checked_at: string | null
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

  // 全量体检：waitUntil 后台跑（10ms CPU 限制内逐个检测）
  app.post('/api/admin/health/run', async (c) => {
    const { cfg } = await loadConfig(c.env.DB, c.env)
    if (!cfg.linkCheck.enabled) return jsonError(400, 'health_disabled', '体检总开关已关闭（linkCheck.enabled）')
    const n = await countActive(c)
    if (n === 0) return c.json({ started: 0 })
    c.executionCtx.waitUntil(runHealthRound(c.env, cfg))
    return c.json({ started: n })
  })

  app.get('/api/admin/articles', async (c) => {
    const friendId = Number(c.req.query('friendId'))
    const where = Number.isInteger(friendId) && friendId > 0 ? 'WHERE a.friend_id = ?' : ''
    const stmt = c.env.DB.prepare(
      `SELECT a.id, a.friend_id, f.author AS friend_author, a.guid, a.title, a.link, a.author, a.published_at, a.fetched_at
         FROM articles a JOIN friends f ON f.id = a.friend_id
         ${where}
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT 200`,
    )
    const rows = Number.isInteger(friendId) && friendId > 0 ? await stmt.bind(friendId).all<Record<string, unknown>>() : await stmt.all<Record<string, unknown>>()
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
    c.executionCtx.waitUntil(runManualRound(c.env.DB, c.env, cfg, 'crawl'))
    return c.json({ started: n })
  })

  // 单源手动抓取（同步执行，返回该源结果）
  app.post('/api/admin/crawl/:friendId', async (c) => {
    const friendId = Number(c.req.param('friendId'))
    if (!Number.isInteger(friendId)) return jsonError(400, 'invalid_id', 'id 不合法')
    const friend = await c.env.DB.prepare('SELECT id, author, link, feed, in_circle FROM friends WHERE id = ? AND status = ?')
      .bind(friendId, 'active')
      .first<{ id: number; author: string; link: string; feed: string | null; in_circle: number }>()
    if (!friend) return jsonError(404, 'not_found', '友链不存在或未启用')
    const { cfg } = await loadConfig(c.env.DB, c.env)
    if (friend.feed && !cfg.crawl.enabled && !cfg.linkCheck.enabled) {
      return jsonError(400, 'crawl_disabled', '抓取总开关已关闭（crawl.enabled）')
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

  // 自动探测：RSS 发现（<link> 声明优先 + 常见路径）、favicon、站点标题、og:image
  app.post('/api/admin/friends/:id/probe', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const friend = await c.env.DB.prepare('SELECT id, author, link, feed FROM friends WHERE id = ?')
      .bind(id)
      .first<{ id: number; author: string; link: string; feed: string | null }>()
    if (!friend) return jsonError(404, 'not_found', '友链不存在')

    const { cfg } = await loadConfig(c.env.DB, c.env)

    const home = await fetchRemote(c.env, { url: friend.link, cfg, timeoutSeconds: cfg.crawl.timeoutSeconds, proxyMode: 'fallback' })
    if (home.error || home.status >= 400 || home.body === null) {
      return jsonError(502, 'probe_unreachable', home.error ?? `站点不可达（HTTP ${home.status}）`)
    }

    const out: { feed?: string; title?: string; icon?: string; avatar?: string } = {}

    // feed：已配置则不重复发现；否则声明式优先、常见路径兜底
    if (!friend.feed) {
      const declared = extractDeclaredFeeds(home.body, home.finalUrl)
      for (const candidate of [...declared, ...commonFeedPaths(friend.link)].slice(0, 4)) {
        const res = await fetchRemote(c.env, { url: candidate, cfg, timeoutSeconds: cfg.crawl.timeoutSeconds, proxyMode: 'fallback' })
        if (res.error || res.status !== 200) continue
        try {
          await withResolvedGuids(await parseFeed(res.body ?? ''))
          out.feed = candidate
          break
        } catch { /* 下一个 */ }
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
        const res = await fetchRemote(c.env, { url: favicon, cfg, timeoutSeconds: Math.min(5, cfg.crawl.timeoutSeconds), proxyMode: 'fallback' })
        if (res.status < 400) out.icon = favicon
      } catch { /* 忽略 */ }
    }

    const ogImage = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']{1,1000})["']/i.exec(home.body)?.[1]
      ?? /<meta[^>]+content=["']([^"']{1,1000})["'][^>]+property=["']og:image["']/i.exec(home.body)?.[1]
    if (ogImage) {
      try {
        out.avatar = new URL(ogImage, home.finalUrl).toString()
      } catch { /* 忽略非法 */ }
    }

    return c.json({ probe: out })
  })

  return app
}

async function countActive(c: Context<AppEnv>): Promise<number> {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE status = 'active'").first<{ n: number }>()
  return row?.n ?? 0
}

/** 全量体检：三路 + 反链，写回 source_state */
export async function runHealthRound(env: AppEnv['Bindings'], cfg: AppConfig): Promise<void> {
  const db = env.DB
  const friends = await db
    .prepare('SELECT id, author, link, feed, in_circle FROM friends WHERE status = ? ORDER BY id')
    .bind('active')
    .all<{ id: number; author: string; link: string; feed: string | null; in_circle: number }>()
  const states = await db
    .prepare(
      `SELECT friend_id, unreachable_since, rss_unavailable_since, fail_count
         FROM source_state WHERE friend_id IN (${friends.results.map(() => '?').join(',') || 'NULL'})`,
    )
    .bind(...friends.results.map((f) => f.id))
    .all<{ friend_id: number; unreachable_since: string | null; rss_unavailable_since: string | null; fail_count: number }>()
    .catch(() => ({ results: [] as { friend_id: number; unreachable_since: string | null; rss_unavailable_since: string | null; fail_count: number }[] }))
  const stateById = new Map(states.results.map((s) => [s.friend_id, s]))

  const startedAt = new Date().toISOString()
  let done = 0
  await runtimeSet(db, 'internal.round', { kind: 'health', startedAt, done: 0, total: friends.results.length })

  const queue = [...friends.results]
  const workers = Array.from({ length: Math.min(cfg.linkCheck.concurrency, queue.length) }, async () => {
    for (;;) {
      const f = queue.shift()
      if (!f) return
      const friend: FriendRow = { id: f.id, author: f.author, link: f.link, feed: f.feed, in_circle: f.in_circle }
      try {
        const result = await checkFriendHealth(env, cfg, friend)
        await persistHealth(db, cfg, friend.id, result, stateById.get(friend.id) ?? null)
      } catch (e) {
        console.error(`[health] friend ${f.id} unhandled:`, e)
      }
      done++
      await runtimeSet(db, 'internal.round', { kind: 'health', startedAt, done, total: friends.results.length })
    }
  })
  await Promise.all(workers)
}
