import { Hono } from 'hono'
import type { AppConfig, AppEnv } from '../types'
import { isoUtc, daysSince } from '../util/time'
import { listPublicGroups } from '../repositories/links'
import type { FriendRow, SourceStateRow } from '../server/schema'

/**
 * 友链数据接口（DESIGN §4.1）
 *   GET /api/links           全部分组
 *   GET /api/links?group=X   按分组名过滤（精确匹配）
 */

export interface LinkOutput {
  author: string
  title?: string
  desc?: string
  link: string
  feed?: string
  icon?: string
  avatar?: string
  archs?: string[]
  since: string
  comment?: string
  health?: {
    reachable?: boolean
    crawlable?: boolean
    /** true/false；null=未检测 */
    backlink: boolean | null
    /** 秒；不可达为 -1 */
    latency?: number
    lastPostAt?: string
    staleDays?: number
    /** 失联天数；正常 null */
    unreachableDays?: number | null
    checkedAt: string
  }
}

export function buildLink(f: FriendRow, s: SourceStateRow | null): LinkOutput {
  const out: LinkOutput = { author: f.author, link: f.link, since: f.since }
  if (f.title) out.title = f.title
  if (f.desc) out.desc = f.desc
  if (f.feed) out.feed = f.feed
  if (f.icon) out.icon = f.icon
  if (f.avatar) out.avatar = f.avatar
  if (f.archs && f.archs.length > 0) out.archs = f.archs
  if (f.comment) out.comment = f.comment

  if (s?.checkedAt) {
    const health: Omit<NonNullable<LinkOutput['health']>, 'checkedAt'> = {
      // checked=1 但值为 NULL（页面不可达/非 2xx）= 未检测到，不是“确定无反链”
      backlink: s.backlinkChecked ? (s.backlink === null ? null : s.backlink === 1) : null,
    }
    if (s.reachable !== null) health.reachable = s.reachable === 1
    if (s.crawlable !== null) health.crawlable = s.crawlable === 1
    if (s.reachable === 0) {
      health.latency = -1
    } else if (s.latencyMs !== null) {
      health.latency = Math.round((s.latencyMs / 1000) * 100) / 100
    }
    const lastPostAt = isoUtc(s.lastPostPublished)
    if (lastPostAt) health.lastPostAt = lastPostAt
    if (s.lastPostDaysAgo !== null) health.staleDays = s.lastPostDaysAgo
    health.unreachableDays = s.reachable === 0 && s.unreachableSince ? (daysSince(s.unreachableSince) ?? null) : null
    const checkedAt = isoUtc(s.checkedAt)
    if (checkedAt) out.health = { ...health, checkedAt }
  }
  return out
}

export function corsHeaders(cfg: AppConfig): Record<string, string> {
  const origin = cfg.api.corsOrigin || '*'
  const h: Record<string, string> = { 'Access-Control-Allow-Origin': origin }
  if (origin !== '*') h.Vary = 'Origin'
  return h
}

export function publicRoutes() {
  const app = new Hono<AppEnv>()

  // 健康检查：供 uptime 监控；附带数据库可达性
  app.get('/healthz', async (c) => {
    let db = true
    try {
      await c.env.DB.prepare('SELECT 1').first()
    } catch {
      db = false
    }
    return c.json(
      { ok: db, db },
      db ? 200 : 503,
      { 'Cache-Control': 'no-store' },
    )
  })

  app.get('/api/links', async (c) => {
    const cfg = c.get('cfg')
    const groups = listPublicGroups(c.env.DB, cfg.api.includeHidden, c.req.query('group')).map((g) => {
      const out: { name: string; desc?: string; links: LinkOutput[] } = { name: g.name, links: [] }
      if (g.desc) out.desc = g.desc
      for (const entry of g.links) out.links.push(buildLink(entry.friend, entry.state))
      return out
    })

    return c.json({ groups }, 200, {
      ...corsHeaders(cfg),
      'Cache-Control': `public, max-age=${cfg.api.cacheSeconds}`,
    })
  })

  app.options('/api/links', (c) => {
    const cfg = c.get('cfg')
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders(cfg), 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    })
  })

  return app
}
