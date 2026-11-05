import { Hono } from 'hono'
import { readJsonOrThrow } from '../../util/http'
import { importData } from '../../services/import'
import type { AppEnv } from '../../types'

/**
 * 数据导入（DESIGN §5 POST /api/admin/import）
 * 接受"任意来源 JSON"：常见字段别名做映射，按 link 去重 upsert（缺省字段保留旧值）。
 */

export function importRoutes() {
  const app = new Hono<AppEnv>()

  app.post('/api/admin/import', async (c) => c.json(importData(c.env.DB, await readJsonOrThrow(c))))

  return app
}
