import { Hono } from 'hono'
import { readJsonOrThrow } from '../../util/http'
import { parseId } from '../../services/validation'
import {
  approveApplication,
  listApplicationViews,
  rebuildNow,
  rejectApplication,
} from '../../services/applications'
import type { AppEnv } from '../../types'

/**
 * 申请队列（DESIGN §5/§7）：
 *   GET  /api/admin/applications?status=pending|approved|rejected|all
 *   POST /api/admin/applications/:id/approve  通过 → 建友链（可选分组/字段覆盖）+ 可选触发重建
 *   POST /api/admin/applications/:id/reject   { reason }
 *   POST /api/admin/rebuild                   手动触发接入方重建
 */

export function applicationRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/applications', (c) =>
    c.json({ applications: listApplicationViews(c.env.DB, c.req.query('status') ?? 'pending') }),
  )

  app.post('/api/admin/applications/:id/approve', async (c) => {
    const result = await approveApplication(
      c.env.DB,
      c.env,
      c.get('cfg'),
      parseId(c.req.param('id')),
      await readJsonOrThrow(c),
    )
    return c.json({ ok: true, ...result })
  })

  app.post('/api/admin/applications/:id/reject', async (c) => {
    rejectApplication(c.env.DB, parseId(c.req.param('id')), await readJsonOrThrow(c))
    return c.json({ ok: true })
  })

  // 手动触发接入方重建（DESIGN §5）
  app.post('/api/admin/rebuild', async (c) => {
    const result = await rebuildNow(c.env, c.get('cfg'), await readJsonOrThrow(c))
    return c.json({ ok: true, ...result })
  })

  return app
}
