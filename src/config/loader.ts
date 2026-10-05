import type { Env, AppConfig } from '../types'
import { CONFIG_FIELDS, CONFIG_TOP_KEYS } from './definition'
import { fieldSchemas, toNested, type FlatSettings } from './schema'

/**
 * 配置三层合并（DESIGN §9）：
 *   代码默认值 ← D1 settings 表 ← 环境变量 YOULIN_CONFIG_OVERRIDES
 *
 * 任何一层损坏（坏 JSON / 非法值）都不阻断运行：按键丢弃并 console.warn，
 * 该键回退到下一层。返回扁平合并结果 + 嵌套视图。
 */

export function defaultsFlat(): FlatSettings {
  const out: FlatSettings = {}
  for (const f of CONFIG_FIELDS) out[f.key] = f.default
  return out
}

function parseFlatJson(text: string | undefined, source: string): FlatSettings {
  if (!text) return {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    console.warn(`[config] ${source} 不是合法 JSON，已忽略`)
    return {}
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`[config] ${source} 应为 JSON 对象，已忽略`)
    return {}
  }
  return raw as FlatSettings
}

/** 部分覆盖表 → 逐键校验：坏键剔除（回退默认），未知键剔除；绝不整表回退 */
function sanitize(flat: FlatSettings, source: string): FlatSettings {
  const out: FlatSettings = {}
  const bad: string[] = []
  for (const [k, v] of Object.entries(flat)) {
    const schema = fieldSchemas[k]
    if (!schema) {
      bad.push(k)
      continue
    }
    const r = schema.safeParse(v)
    if (r.success) out[k] = r.data
    else bad.push(k)
  }
  if (bad.length > 0) console.warn(`[config] ${source} 非法/未知配置键已回退默认值：${bad.join(', ')}`)
  return out
}

export async function loadFlatSettings(db: Env['DB'], env: Env): Promise<FlatSettings> {
  let merged = defaultsFlat()

  // 第二层：D1 settings 表
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const stored: FlatSettings = {}
  for (const row of rows.results) {
    if (row.key.startsWith('internal.')) continue // 运行时簿记（轮转进度等），不属于应用配置
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      console.warn(`[config] settings 表键 ${row.key} 值不是合法 JSON，已忽略`)
    }
  }
  merged = { ...merged, ...sanitize(stored, 'settings 表') }

  // 第三层：环境变量覆盖
  const overrides = parseFlatJson(env.YOULIN_CONFIG_OVERRIDES, 'YOULIN_CONFIG_OVERRIDES')
  if (Object.keys(overrides).length > 0) {
    merged = { ...merged, ...sanitize(overrides, 'YOULIN_CONFIG_OVERRIDES') }
  }

  // settings 自身的版本号不属于 AppConfig，剔除
  delete merged['settings.schemaVersion']
  return merged
}

export interface LoadedConfig {
  /** 嵌套视图：cfg.site.name 等；仅含已知顶层分组 */
  cfg: AppConfig
  /** 扁平合并视图（含全部键） */
  flat: FlatSettings
}

export async function loadConfig(db: Env['DB'], env: Env): Promise<LoadedConfig> {
  const flat = await loadFlatSettings(db, env)
  const nested = toNested(flat)
  const cfg = {} as AppConfig
  for (const top of CONFIG_TOP_KEYS) {
    // @ts-expect-error 动态装配；键集合与 AppConfig 由 config.test 保证一致
    cfg[top] = nested[top] ?? {}
  }
  return { cfg, flat }
}
