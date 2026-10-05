import { Hono } from 'hono'
import type { AppEnv } from '../../types'

/**
 * 数据导出（DESIGN §5 GET /api/admin/export?format=json）
 * v1 先提供 JSON 全量导出（含 hidden 与全部管理字段）；CSV / OPML 随 P3 文档一起提供。
 */

interface Row {
  name: string
  desc: string | null
  link: string | null
  author: string
  nickname: string | null
  title: string | null
  desc2: string | null
  feed: string | null
  icon: string | null
  avatar: string | null
  archs: string | null
  since: string
  comment: string | null
  in_circle: number
  status: string
  created_at: string
}

export function exportRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/export', async (c) => {
    const format = c.req.query('format') ?? 'json'
    if (format !== 'json') {
      return c.json({ error: { code: 'unsupported_format', message: `格式 ${format} 暂未提供（v1 支持 json，CSV/OPML 随 P3 提供）` } }, 400)
    }
    const rows = await c.env.DB.prepare(
      `SELECT g.name, g."desc",
              f.author, f.nickname, f.title, f."desc" AS desc2, f.link, f.feed, f.icon, f.avatar,
              f.archs, f.since, f.comment, f.in_circle, f.status, f.created_at
         FROM groups g LEFT JOIN friends f ON f.group_id = g.id
        ORDER BY g.sort, g.id, f.sort, f.id`,
    ).all<Row>()

    const groups: { name: string; desc?: string; links: Record<string, unknown>[] }[] = []
    for (const r of rows.results) {
      let g = groups.find((x) => x.name === r.name)
      if (!g) {
        g = { name: r.name, links: [] }
        if (r.desc) g.desc = r.desc
        groups.push(g)
      }
      if (!r.link) continue // 空组
      let archs: string[] | undefined
      if (r.archs) {
        try {
          const arr = JSON.parse(r.archs) as unknown
          if (Array.isArray(arr)) archs = arr.filter((x): x is string => typeof x === 'string')
        } catch { /* 忽略 */ }
      }
      const link: Record<string, unknown> = {
        author: r.author,
        link: r.link,
        since: r.since,
        inCircle: r.in_circle === 1,
        status: r.status,
        addedAt: r.created_at ? r.created_at.replace(' ', 'T') + 'Z' : undefined,
      }
      if (r.nickname) link.nickname = r.nickname
      if (r.title) link.title = r.title
      if (r.desc2) link.desc = r.desc2
      if (r.feed) link.feed = r.feed
      if (r.icon) link.icon = r.icon
      if (r.avatar) link.avatar = r.avatar
      if (archs && archs.length > 0) link.archs = archs
      if (r.comment) link.comment = r.comment
      g.links.push(link)
    }

    return new Response(JSON.stringify({ exportedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), groups }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="youlin-data.json"',
      },
    })
  })

  return app
}
