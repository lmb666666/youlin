import { z } from 'zod'
import { AppError } from '../errors'
import { fieldDetails } from '../util/http'
import { CONFIG_VERSION } from '../config/definition'
import { defaultsFlat, invalidateConfigCache, loadFlatSettings } from '../config/loader'
import { fieldSchemas, settingsImportZod, settingsSchemaPayload } from '../config/schema'
import { replaceConfigSettings, upsertSettings } from '../repositories/settings'
import type { Db, Env } from '../types'

export async function getSettings(db: Db, env: Env): Promise<{ version: number; values: Record<string, unknown> }> {
  return { version: CONFIG_VERSION, values: await loadFlatSettings(db, env) }
}

export function getSettingsSchema() {
  return settingsSchemaPayload()
}

/** 批量更新（浅合并：只写、只校验提供的键） */
export async function updateSettings(db: Db, env: Env, raw: unknown): Promise<{ version: number; values: Record<string, unknown> }> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError(400, 'invalid_body', '请求体须为 JSON 对象')
  }
  const patch = raw as Record<string, unknown>
  const unknownKeys = Object.keys(patch).filter((k) => !(k in fieldSchemas))
  if (unknownKeys.length > 0) throw new AppError(400, 'unknown_keys', '存在未知配置键', { keys: unknownKeys })

  const subShape: Record<string, z.ZodType> = {}
  for (const k of Object.keys(patch)) subShape[k] = fieldSchemas[k]!
  const parsed = z.object(subShape).safeParse(patch)
  if (!parsed.success) {
    throw new AppError(400, 'validation_failed', '配置校验失败', fieldDetails(parsed.error.issues))
  }

  upsertSettings(db, parsed.data)
  invalidateConfigCache()
  return { version: CONFIG_VERSION, values: await loadFlatSettings(db, env) }
}

/** 导入（整表替换；用于备份恢复 / 配置模板） */
export async function importSettings(db: Db, env: Env, raw: unknown): Promise<{ version: number; values: Record<string, unknown> }> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppError(400, 'invalid_body', '请求体须为 JSON 对象')
  }
  const incoming = raw as Record<string, unknown>
  const unknownKeys = Object.keys(incoming).filter((k) => !(k in fieldSchemas))
  if (unknownKeys.length > 0) throw new AppError(400, 'unknown_keys', '存在未知配置键', { keys: unknownKeys })

  const parsed = settingsImportZod.safeParse(incoming)
  if (!parsed.success) {
    throw new AppError(400, 'validation_failed', '配置校验失败', fieldDetails(parsed.error.issues))
  }
  // 旧版导出的文件可能缺少后续新增的键：缺失项回退默认值，其余按键替换
  replaceConfigSettings(db, { ...defaultsFlat(), ...parsed.data })
  invalidateConfigCache()
  return { version: CONFIG_VERSION, values: await loadFlatSettings(db, env) }
}

export async function exportSettings(db: Db, env: Env): Promise<Record<string, unknown>> {
  return loadFlatSettings(db, env)
}
