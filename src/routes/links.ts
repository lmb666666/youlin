import { Hono } from 'hono'
import type { AppConfig, AppEnv } from '../types'
import { isoUtc, daysSince } from '../util/time'

/**
 * 友链数据接口（DESIGN §4.1）
 *   GET /api/links           全部分组
 *   GET /api/links?group=X   按分组名过滤（精确匹配）
 */

interface FriendRow {
  id: number
  group_id: number
  author: string
  title: string | null
  desc: string | null
  link: string
  feed: string | null
  icon: string | null
  avatar: string | null
  archs: string | null
  since: string
  comment: string | null
  status: string
}

interface GroupRow {
  id: number
  name: string
  desc: string | null
}

interface StateRow {
  friend_id: number
  reachable: number | null
  crawlable: number | null
  backlink_checked: number | null
  backlink: number | null
  latency_ms: number | null
  last_post_published: string | null
  last_post_days_ago: number | null
  unreachable_since: string | null
  checked_at: string | null
}

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

export function buildLink(f: FriendRow, s: StateRow | undefined): LinkOutput {
  const out: LinkOutput = { author: f.author, link: f.link, since: f.since }
  if (f.title) out.title = f.title
  if (f.desc) out.desc = f.desc
  if (f.feed) out.feed = f.feed
  if (f.icon) out.icon = f.icon
  if (f.avatar) out.avatar = f.avatar
  if (f.archs) {
    try {
      const arr = JSON.parse(f.archs) as unknown
      if (Array.isArray(arr) && arr.length > 0) out.archs = arr.filter((x): x is string => typeof x === 'string')
    } catch { /* 忽略坏数据 */ }
  }
  if (f.comment) out.comment = f.comment

  if (s?.checked_at) {
    const health: Omit<NonNullable<LinkOutput['health']>, 'checkedAt'> = { backlink: s.backlink_checked ? Boolean(s.backlink) : null }
    if (s.reachable !== null) health.reachable = s.reachable === 1
    if (s.crawlable !== null) health.crawlable = s.crawlable === 1
    if (s.reachable === 0) {
      health.latency = -1
    } else if (s.latency_ms !== null) {
      health.latency = Math.round((s.latency_ms / 1000) * 100) / 100
    }
    const lastPostAt = isoUtc(s.last_post_published)
    if (lastPostAt) health.lastPostAt = lastPostAt
    if (s.last_post_days_ago !== null) health.staleDays = s.last_post_days_ago
    health.unreachableDays = s.reachable === 0 && s.unreachable_since ? (daysSince(s.unreachable_since) ?? null) : null
    const checkedAt = isoUtc(s.checked_at)
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

  // 健康检查：供 uptime 监控；附带 D1 可达性
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
    const groupName = c.req.query('group')

    const groupRows = await c.env.DB.prepare('SELECT id, name, "desc" FROM groups ORDER BY sort, id').all<GroupRow>()
    // hidden 过滤下推 SQL，避免全量扫描后在 JS 过滤
    const where = cfg.api.includeHidden ? '' : "WHERE f.status = 'active'"
    const friendRows = await c.env.DB.prepare(
      `SELECT f.id, f.group_id, f.author, f.title, f."desc", f.link, f.feed, f.icon, f.avatar,
              f.archs, f.since, f.comment, f.status
         FROM friends f ${where} ORDER BY f.sort, f.id`,
    ).all<FriendRow>()
    const stateRows = await c.env.DB.prepare(
      `SELECT friend_id, reachable, crawlable, backlink_checked, backlink, latency_ms,
              last_post_published, last_post_days_ago, unreachable_since, checked_at
         FROM source_state`,
    ).all<StateRow>()

    const stateByFriend = new Map(stateRows.results.map((s) => [s.friend_id, s]))
    const friendsByGroup = new Map<number, FriendRow[]>()
    for (const f of friendRows.results) {
      const list = friendsByGroup.get(f.group_id) ?? []
      list.push(f)
      friendsByGroup.set(f.group_id, list)
    }

    const groups = groupRows.results
      .filter((g) => groupName === undefined || g.name === groupName)
      .map((g) => {
        const out: { name: string; desc?: string; links: LinkOutput[] } = { name: g.name, links: [] }
        if (g.desc) out.desc = g.desc
        for (const f of friendsByGroup.get(g.id) ?? []) {
          out.links.push(buildLink(f, stateByFriend.get(f.id)))
        }
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
