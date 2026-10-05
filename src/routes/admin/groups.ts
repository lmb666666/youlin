import { Hono } from 'hono'
import { z } from 'zod'
import { jsonError, fieldDetails, readJson } from '../../util/http'
import type { AppEnv } from '../../types'

interface GroupRow {
  id: number
  name: string
  desc: string | null
  sort: number
}

export function groupRoutes() {
  const app = new Hono<AppEnv>()

  const createSchema = z.object({
    name: z.string().min(1).max(100),
    desc: z.string().max(2000).optional().nullable(),
    sort: z.number().int().optional(),
  })
  const updateSchema = createSchema.partial()

  app.get('/api/admin/groups', async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT g.id, g.name, g."desc", g.sort, COUNT(f.id) AS friend_count
         FROM groups g LEFT JOIN friends f ON f.group_id = g.id
        GROUP BY g.id ORDER BY g.sort, g.id`,
    ).all<{ id: number; name: string; desc: string | null; sort: number; friend_count: number }>()
    return c.json({
      groups: rows.results.map((g) => ({
        id: g.id,
        name: g.name,
        desc: g.desc ?? undefined,
        sort: g.sort,
        friendCount: g.friend_count,
      })),
    })
  })

  app.post('/api/admin/groups', async (c) => {
    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    }
    const { name, desc } = parsed.data
    const dup = await c.env.DB.prepare('SELECT id FROM groups WHERE name = ?').bind(name).first()
    if (dup) return jsonError(409, 'duplicate_name', '同名分组已存在')
    const sort =
      parsed.data.sort ??
      ((await c.env.DB.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM groups').first<{ next: number }>())
        ?.next ?? 0)
    const res = await c.env.DB.prepare('INSERT INTO groups (name, "desc", sort) VALUES (?, ?, ?)')
      .bind(name, desc ?? null, sort)
      .run()
    return c.json({ id: res.meta.last_row_id }, 201)
  })

  app.patch('/api/admin/groups/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    }
    const row = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(id).first()
    if (!row) return jsonError(404, 'not_found', '分组不存在')

    const sets: string[] = []
    const binds: unknown[] = []
    if (parsed.data.name !== undefined) {
      const dup = await c.env.DB.prepare('SELECT id FROM groups WHERE name = ? AND id != ?').bind(parsed.data.name, id).first()
      if (dup) return jsonError(409, 'duplicate_name', '同名分组已存在')
      sets.push('name = ?')
      binds.push(parsed.data.name)
    }
    if (parsed.data.desc !== undefined) {
      sets.push('"desc" = ?')
      binds.push(parsed.data.desc)
    }
    if (parsed.data.sort !== undefined) {
      sets.push('sort = ?')
      binds.push(parsed.data.sort)
    }
    if (sets.length > 0) {
      binds.push(id)
      await c.env.DB.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
    }
    return c.json({ ok: true })
  })

  app.delete('/api/admin/groups/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    // 友链及其文章/抓取状态随之删除（显式清理，不依赖外键级联）
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM articles WHERE friend_id IN (SELECT id FROM friends WHERE group_id = ?)').bind(id),
      c.env.DB.prepare('DELETE FROM source_state WHERE friend_id IN (SELECT id FROM friends WHERE group_id = ?)').bind(id),
      c.env.DB.prepare('DELETE FROM friends WHERE group_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id),
    ])
    return c.json({ ok: true })
  })

  app.post('/api/admin/groups/reorder', async (c) => {
    const body = await readJson(c)
    const parsed = z.object({ items: z.array(z.object({ id: z.number().int(), sort: z.number().int() })).min(1) }).safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    await c.env.DB.batch(
      parsed.data.items.map((it) => c.env.DB.prepare('UPDATE groups SET sort = ? WHERE id = ?').bind(it.sort, it.id)),
    )
    return c.json({ ok: true })
  })

  return app
}
