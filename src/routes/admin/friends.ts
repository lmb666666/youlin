import { Hono } from 'hono'
import { readJsonOrThrow } from '../../util/http'
import { parseId } from '../../services/validation'
import {
  createFriend,
  deleteFriend,
  listFriendViews,
  reorderFriends,
  updateFriend,
} from '../../services/friends'
import type { AppEnv } from '../../types'

export function friendRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/friends', (c) => c.json({ friends: listFriendViews(c.env.DB) }))

  app.post('/api/admin/friends', async (c) => {
    const friend = createFriend(c.env.DB, c.env, c.get('cfg'), await readJsonOrThrow(c))
    return c.json(friend, 201)
  })

  app.patch('/api/admin/friends/:id', async (c) => {
    updateFriend(c.env.DB, c.env, c.get('cfg'), parseId(c.req.param('id')), await readJsonOrThrow(c))
    return c.json({ ok: true })
  })

  app.delete('/api/admin/friends/:id', (c) => {
    deleteFriend(c.env.DB, c.env, c.get('cfg'), parseId(c.req.param('id')))
    return c.json({ ok: true })
  })

  // 拖拽排序：批量写入新 sort（可选同时改分组）
  app.post('/api/admin/friends/reorder', async (c) => {
    reorderFriends(c.env.DB, await readJsonOrThrow(c))
    return c.json({ ok: true })
  })

  return app
}
