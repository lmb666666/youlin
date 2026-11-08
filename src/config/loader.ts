import type { Env, AppConfig } from '../types'
import { CONFIG_FIELDS, CONFIG_TOP_KEYS } from './definition'
import { fieldSchemas, toNested, type FlatSettings } from './schema'
import { listSettings } from '../repositories/settings'
import { logger } from '../log'

/**
 * 配置三层合并（DESIGN §9）：
 *   代码默认值 ← SQLite settings 表 ← 环境变量 YOULIN_CONFIG_OVERRIDES
 *
 * 任何一层损坏（坏 JSON / 非法值）都不阻断运行：按键丢弃并记录 warning，
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
    logger.warn({ source }, 'config source is not valid JSON, ignored')
    return {}
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    logger.warn({ source }, 'config source is not a JSON object, ignored')
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
  if (bad.length > 0) logger.warn({ source, keys: bad }, 'invalid/unknown config keys fall back to defaults')
  return out
}

// 每个请求都读全量 settings 会形成明显的数据库读放大；
// 用进程内短 TTL 缓存，设置写入后立即失效，多进程最坏延迟 5 秒。
let cache: { key: string; at: number; flat: FlatSettings } | null = null
let cacheMs = 5_000

export function setConfigCacheMs(ms: number): void {
  cacheMs = Math.max(0, ms)
  cache = null
}

export function invalidateConfigCache(): void {
  cache = null
}

export async function loadFlatSettings(db: Env['DB'], env: Env): Promise<FlatSettings> {
  const cacheKey = env.YOULIN_CONFIG_OVERRIDES ?? ''
  if (cache && cache.key === cacheKey && Date.now() - cache.at < cacheMs) {
    return { ...cache.flat }
  }

  let merged = defaultsFlat()

  // 第二层：SQLite settings 表
  const stored: FlatSettings = {}
  for (const row of listSettings(db)) {
    // internal.* 是运行时簿记（轮转进度等），settings.* 是表自身的版本号，都不属于应用配置
    if (row.key.startsWith('internal.') || row.key.startsWith('settings.')) continue
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      logger.warn({ key: row.key }, 'settings value is not valid JSON, ignored')
    }
  }
  merged = { ...merged, ...sanitize(stored, 'settings 表') }

  // 第三层：环境变量覆盖
  const overrides = parseFlatJson(env.YOULIN_CONFIG_OVERRIDES, 'YOULIN_CONFIG_OVERRIDES')
  if (Object.keys(overrides).length > 0) {
    merged = { ...merged, ...sanitize(overrides, 'YOULIN_CONFIG_OVERRIDES') }
  }

  if (cacheMs > 0) cache = { key: cacheKey, at: Date.now(), flat: merged }
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
