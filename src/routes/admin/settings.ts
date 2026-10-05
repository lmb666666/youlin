import { Hono } from 'hono'
import { z } from 'zod'
import { jsonError, fieldDetails, readJson } from '../../util/http'
import { settingsZod, settingsSchemaPayload, fieldSchemas } from '../../config/schema'
import { CONFIG_VERSION } from '../../config/definition'
import { loadFlatSettings } from '../../config/loader'
import type { AppEnv } from '../../types'

export function settingsRoutes() {
  const app = new Hono<AppEnv>()

  // 合并后的全量配置（含默认值）
  app.get('/api/admin/settings', async (c) => {
    const flat = await loadFlatSettings(c.env.DB, c.env)
    return c.json({ version: CONFIG_VERSION, values: flat })
  })

  // 设置表单 schema（管理台据此自动渲染）
  app.get('/api/admin/settings/schema', (c) => c.json(settingsSchemaPayload()))

  // 批量更新（浅合并：只写、只校验提供的键）
  app.put('/api/admin/settings', async (c) => {
    const body = await readJson(c)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError(400, 'invalid_body', '请求体须为 JSON 对象（键为配置项，值为新值）')
    }
    const patch = body as Record<string, unknown>
    const unknownKeys = Object.keys(patch).filter((k) => !(k in fieldSchemas))
    if (unknownKeys.length > 0) {
      return jsonError(400, 'unknown_keys', '存在未知配置键', { keys: unknownKeys })
    }
    const subShape: Record<string, z.ZodType> = {}
    for (const k of Object.keys(patch)) subShape[k] = fieldSchemas[k]!
    const parsed = z.object(subShape).safeParse(patch)
    if (!parsed.success) {
      return jsonError(400, 'validation_failed', '配置校验失败', fieldDetails(parsed.error.issues))
    }

    await c.env.DB.batch(
      Object.entries(parsed.data).map(([k, v]) =>
        c.env.DB.prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).bind(k, JSON.stringify(v)),
      ),
    )
    const flat = await loadFlatSettings(c.env.DB, c.env)
    return c.json({ version: CONFIG_VERSION, values: flat })
  })

  // 导入（整表替换；用于备份恢复 / 配置模板）
  app.post('/api/admin/settings/import', async (c) => {
    const body = await readJson(c)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return jsonError(400, 'invalid_body', '请求体须为 JSON 对象')
    }
    const incoming = body as Record<string, unknown>
    const unknownKeys = Object.keys(incoming).filter((k) => !(k in fieldSchemas))
    if (unknownKeys.length > 0) {
      return jsonError(400, 'unknown_keys', '存在未知配置键', { keys: unknownKeys })
    }
    const parsed = settingsZod.safeParse(incoming)
    if (!parsed.success) {
      return jsonError(400, 'validation_failed', '配置校验失败', fieldDetails(parsed.error.issues))
    }
    const entries = Object.entries(parsed.data)
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM settings WHERE key != ?').bind('settings.schemaVersion'),
      ...entries.map(([k, v]) =>
        c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .bind(k, JSON.stringify(v)),
      ),
    ])
    const flat = await loadFlatSettings(c.env.DB, c.env)
    return c.json({ version: CONFIG_VERSION, values: flat })
  })

  // 导出（带下载头的全量配置）
  app.get('/api/admin/settings/export', async (c) => {
    const flat = await loadFlatSettings(c.env.DB, c.env)
    return new Response(JSON.stringify(flat, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="youlin-settings.json"',
      },
    })
  })

  return app
}
