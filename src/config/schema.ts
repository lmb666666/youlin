import { z } from 'zod'
import { CONFIG_FIELDS, CONFIG_GROUPS, CONFIG_VERSION, type ConfigField, type ConfigGroup } from './definition'

/**
 * 由 CONFIG_FIELDS 派生：
 *  - settingsZod：管理台写入校验（严格，拒绝未知键）
 *  - settingsJsonSchema：GET /api/admin/settings/schema 输出，前端据此渲染表单
 */

function fieldZod(f: ConfigField): z.ZodType {
  switch (f.type) {
    case 'boolean':
      return z.boolean()
    case 'number': {
      let s = z.number()
      if (f.min !== undefined) s = s.min(f.min)
      if (f.max !== undefined) s = s.max(f.max)
      return s
    }
    case 'enum': {
      const opts = f.options ?? []
      if (opts.length === 0) return z.string()
      // z.enum 需要元组字面量，运行期定义用 string union 等价表达
      return z.string().refine((v) => opts.includes(v), { message: `取值须为 ${opts.join(' / ')}` })
    }
    case 'stringList':
      return z.array(z.string())
    case 'json':
      // 阶梯：[[number, number], …]；其余 json 字段未来扩展时在此加分项校验
      return z.array(z.tuple([z.number(), z.number()]))
    case 'text':
      return z.string().max(10_000)
    case 'string':
    default:
      return z.string().max(2000)
  }
}

const shape = Object.fromEntries(CONFIG_FIELDS.map((f) => [f.key, fieldZod(f)]))

/** 按键取用的 zod 表（PUT /settings 只校验提交的键） */
export const fieldSchemas = shape as Record<string, z.ZodType>

/** 严格校验：未知键、类型不符都报错（settings import 整表替换用） */
export const settingsZod = z.object(shape).strict()

export type FlatSettings = Record<string, unknown>

export interface SettingsSchemaField {
  key: string
  type: ConfigField['type']
  default: unknown
  label: string
  description: string
  options?: string[]
  min?: number
  max?: number
  placeholder?: string
  full?: boolean
}

export interface SettingsSchemaGroup {
  key: string
  label: string
  description: string
  fields: SettingsSchemaField[]
}

function toSchemaField(f: ConfigField): SettingsSchemaField {
  const out: SettingsSchemaField = {
    key: f.key,
    type: f.type,
    default: f.default,
    label: f.label,
    description: f.description,
  }
  if (f.options) out.options = f.options
  if (f.min !== undefined) out.min = f.min
  if (f.max !== undefined) out.max = f.max
  if (f.placeholder) out.placeholder = f.placeholder
  if (f.full) out.full = true
  return out
}

export function settingsSchemaPayload(): { version: number; groups: SettingsSchemaGroup[] } {
  const groups: SettingsSchemaGroup[] = CONFIG_GROUPS.map((g: ConfigGroup) => ({
    key: g.key,
    label: g.label,
    description: g.description,
    fields: g.fields.map(toSchemaField),
  }))
  return { version: CONFIG_VERSION, groups }
}

/** 扁平 settings → 嵌套视图（AppConfig）。未知顶层键忽略。 */
export function toNested(flat: FlatSettings): Record<string, Record<string, unknown>> {
  const nested: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(flat)) {
    const [top, sub] = key.split('.')
    if (!top || !sub) continue
    ;(nested[top] ??= {})[sub] = value
  }
  return nested
}
