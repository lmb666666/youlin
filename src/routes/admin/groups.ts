import { Hono } from 'hono'
import { readJsonOrThrow } from '../../util/http'
import { parseId } from '../../services/validation'
import { createGroup, deleteGroup, listGroupViews, reorderGroups, updateGroup } from '../../services/groups'
import type { AppEnv } from '../../types'

export function groupRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/groups', (c) => c.json({ groups: listGroupViews(c.env.DB) }))

  app.post('/api/admin/groups', async (c) => {
    const group = createGroup(c.env.DB, await readJsonOrThrow(c))
    return c.json(group, 201)
  })

  app.patch('/api/admin/groups/:id', async (c) => {
    updateGroup(c.env.DB, parseId(c.req.param('id')), await readJsonOrThrow(c))
    return c.json({ ok: true })
  })

  app.delete('/api/admin/groups/:id', (c) => {
    deleteGroup(c.env.DB, parseId(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.post('/api/admin/groups/reorder', async (c) => {
    reorderGroups(c.env.DB, await readJsonOrThrow(c))
    return c.json({ ok: true })
  })

  return app
}
