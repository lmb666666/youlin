import { Hono } from 'hono'
import { z } from 'zod'
import { jsonError, fieldDetails, readJson, isUniqueConstraintError } from '../../util/http'
import { createGroup, deleteGroupCascade, findGroupById, groupNameTaken, listGroups, reorderGroups, updateGroup } from '../../repositories/groups'
import type { AppEnv } from '../../types'

export function groupRoutes() {
  const app = new Hono<AppEnv>()

  const createSchema = z.object({
    name: z.string().min(1).max(100),
    desc: z.string().max(2000).optional().nullable(),
    sort: z.number().int().optional(),
  })
  const updateSchema = createSchema.partial()

  app.get('/api/admin/groups', async (c) => {
    return c.json({
      groups: listGroups(c.env.DB).map((g) => ({
        id: g.id,
        name: g.name,
        desc: g.desc ?? undefined,
        sort: g.sort,
        friendCount: g.friendCount,
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
    const { name, desc, sort } = parsed.data
    if (groupNameTaken(c.env.DB, name)) return jsonError(409, 'duplicate_name', '同名分组已存在')
    try {
      return c.json({ id: createGroup(c.env.DB, { name, desc, sort }) }, 201)
    } catch (e) {
      // 并发创建撞 groups.name 唯一索引，check-then-insert 的竞态兜底
      if (!isUniqueConstraintError(e)) throw e
      return jsonError(409, 'duplicate_name', '同名分组已存在')
    }
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
    if (!findGroupById(c.env.DB, id)) return jsonError(404, 'not_found', '分组不存在')
    if (parsed.data.name !== undefined && groupNameTaken(c.env.DB, parsed.data.name, id)) {
      return jsonError(409, 'duplicate_name', '同名分组已存在')
    }
    try {
      updateGroup(c.env.DB, id, parsed.data)
    } catch (e) {
      if (!isUniqueConstraintError(e)) throw e
      return jsonError(409, 'duplicate_name', '同名分组已存在')
    }
    return c.json({ ok: true })
  })

  app.delete('/api/admin/groups/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    deleteGroupCascade(c.env.DB, id)
    return c.json({ ok: true })
  })

  app.post('/api/admin/groups/reorder', async (c) => {
    const body = await readJson(c)
    const parsed = z.object({ items: z.array(z.object({ id: z.number().int(), sort: z.number().int() })).min(1) }).safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    reorderGroups(c.env.DB, parsed.data.items)
    return c.json({ ok: true })
  })

  return app
}
