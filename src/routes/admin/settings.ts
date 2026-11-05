import { Hono } from 'hono'
import { z } from 'zod'
import { jsonError, fieldDetails, readJson } from '../../util/http'
import { settingsImportZod, settingsSchemaPayload, fieldSchemas } from '../../config/schema'
import { CONFIG_VERSION } from '../../config/definition'
import { defaultsFlat, invalidateConfigCache, loadFlatSettings } from '../../config/loader'
import { replaceConfigSettings, upsertSettings } from '../../repositories/settings'
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
      return jsonError(400, 'invalid_body', '请求体须为 JSON 对象')
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

    upsertSettings(c.env.DB, parsed.data)
    invalidateConfigCache()
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
    const parsed = settingsImportZod.safeParse(incoming)
    if (!parsed.success) {
      return jsonError(400, 'validation_failed', '配置校验失败', fieldDetails(parsed.error.issues))
    }
    // 旧版导出的文件可能缺少后续新增的键：缺失项回退默认值，其余按键替换
    replaceConfigSettings(c.env.DB, { ...defaultsFlat(), ...parsed.data })
    invalidateConfigCache()
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
