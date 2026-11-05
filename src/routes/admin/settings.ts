import { Hono } from 'hono'
import { readJsonOrThrow } from '../../util/http'
import {
  exportSettings,
  getSettings,
  getSettingsSchema,
  importSettings,
  updateSettings,
} from '../../services/settings'
import type { AppEnv } from '../../types'

export function settingsRoutes() {
  const app = new Hono<AppEnv>()

  // 合并后的全量配置（含默认值）
  app.get('/api/admin/settings', async (c) => c.json(await getSettings(c.env.DB, c.env)))

  // 设置表单 schema（管理台据此自动渲染）
  app.get('/api/admin/settings/schema', (c) => c.json(getSettingsSchema()))

  // 批量更新（浅合并：只写、只校验提供的键）
  app.put('/api/admin/settings', async (c) =>
    c.json(await updateSettings(c.env.DB, c.env, await readJsonOrThrow(c))),
  )

  // 导入（整表替换；用于备份恢复 / 配置模板）
  app.post('/api/admin/settings/import', async (c) =>
    c.json(await importSettings(c.env.DB, c.env, await readJsonOrThrow(c))),
  )

  // 导出（带下载头的全量配置）
  app.get('/api/admin/settings/export', async (c) => {
    const flat = await exportSettings(c.env.DB, c.env)
    return new Response(JSON.stringify(flat, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="youlin-settings.json"',
      },
    })
  })

  return app
}
