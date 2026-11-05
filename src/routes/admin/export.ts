import { Hono } from 'hono'
import { exportFriends } from '../../services/export'
import type { AppEnv } from '../../types'

/**
 * 数据导出（DESIGN §5 GET /api/admin/export?format=json|csv|opml）
 *   json  全量结构（含 hidden 与全部管理字段），供备份/再导入
 *   csv   友链表格（Excel 友好，UTF-8 BOM）
 *   opml  订阅列表（RSS 阅读器友好，含 feed 的条目才输出）
 */

export function exportRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/export', (c) => {
    const file = exportFriends(c.env.DB, c.req.query('format') ?? 'json')
    return new Response(file.body, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
      },
    })
  })

  return app
}
