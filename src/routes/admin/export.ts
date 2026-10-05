import { Hono } from 'hono'
import { isoUtc } from '../../util/time'
import type { AppEnv } from '../../types'

/**
 * 数据导出（DESIGN §5 GET /api/admin/export?format=json|csv|opml）
 *   json  全量结构（含 hidden 与全部管理字段），供备份/再导入
 *   csv   友链表格（Excel 友好，UTF-8 BOM）
 *   opml  订阅列表（RSS 阅读器友好，含 feed 的条目才输出）
 */

interface Row {
  group_name: string
  group_desc: string | null
  author: string
  nickname: string | null
  title: string | null
  desc: string | null
  link: string | null
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

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function csvEsc(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return `"${s.replaceAll('"', '""')}"`
}

function parseArchs(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function exportRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/export', async (c) => {
    const format = c.req.query('format') ?? 'json'
    if (!['json', 'csv', 'opml'].includes(format)) {
      return c.json({ error: { code: 'unsupported_format', message: `格式 ${format} 不支持（json / csv / opml）` } }, 400)
    }

    const rows = await c.env.DB.prepare(
      `SELECT g.name AS group_name, g."desc" AS group_desc,
              f.author, f.nickname, f.title, f."desc", f.link, f.feed, f.icon, f.avatar,
              f.archs, f.since, f.comment, f.in_circle, f.status, f.created_at
         FROM groups g LEFT JOIN friends f ON f.group_id = g.id
        ORDER BY g.sort, g.id, f.sort, f.id`,
    ).all<Row>()
    const items = rows.results.filter((r) => r.link !== null)

    if (format === 'csv') {
      const header = ['分组', '作者', '趣称', '标题', '简介', '链接', 'feed', 'icon', '头像', '架构', '订阅日期', '备注', '入圈', '状态', '添加时间']
      const lines = items.map((r) =>
        [
          r.group_name, r.author, r.nickname ?? '', r.title ?? '', r.desc ?? '', r.link ?? '', r.feed ?? '',
          r.icon ?? '', r.avatar ?? '', parseArchs(r.archs).join(' '), r.since, r.comment ?? '',
          r.in_circle === 1 ? '是' : '否', r.status === 'active' ? '显示' : '隐藏', isoUtc(r.created_at) ?? '',
        ]
          .map(csvEsc)
          .join(','),
      )
      return new Response('\ufeff' + [header.map(csvEsc).join(','), ...lines].join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="youlin-friends.csv"',
        },
      })
    }

    if (format === 'opml') {
      const outlines = items
        .filter((r) => r.feed)
        .map(
          (r) =>
            `      <outline type="rss" text="${xmlEsc(r.title ?? r.author)}" title="${xmlEsc(r.title ?? r.author)}" xmlUrl="${xmlEsc(r.feed!)}" htmlUrl="${xmlEsc(r.link ?? '')}" category="${xmlEsc(r.group_name)}" />`,
        )
        .join('\n')
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>友邻 · 友链订阅列表</title>
    <dateCreated>${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dateCreated>
  </head>
  <body>
    <outline text="友邻" title="友邻">
${outlines}
    </outline>
  </body>
</opml>
`
      return new Response(xml, {
        headers: {
          'Content-Type': 'text/x-opml; charset=utf-8',
          'Content-Disposition': 'attachment; filename="youlin-friends.opml"',
        },
      })
    }

    // json：分组结构 + 全部管理字段（可被 /api/admin/import 直接再导入）
    const groups: { name: string; desc?: string; links: Record<string, unknown>[] }[] = []
    for (const r of rows.results) {
      let g = groups.find((x) => x.name === r.group_name)
      if (!g) {
        g = { name: r.group_name, links: [] }
        if (r.group_desc) g.desc = r.group_desc
        groups.push(g)
      }
      if (!r.link) continue
      const link: Record<string, unknown> = {
        author: r.author,
        link: r.link,
        since: r.since,
        inCircle: r.in_circle === 1,
        status: r.status,
        addedAt: isoUtc(r.created_at),
      }
      if (r.nickname) link.nickname = r.nickname
      if (r.title) link.title = r.title
      if (r.desc) link.desc = r.desc
      if (r.feed) link.feed = r.feed
      if (r.icon) link.icon = r.icon
      if (r.avatar) link.avatar = r.avatar
      const archs = parseArchs(r.archs)
      if (archs.length > 0) link.archs = archs
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
