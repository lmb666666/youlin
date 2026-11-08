import { z } from 'zod'
import { CONFIG_FIELDS, CONFIG_GROUPS, CONFIG_VERSION, type ConfigField, type ConfigGroup } from './definition'
import { httpUrl } from '../util/validate'
import type { SettingsSchemaResponse } from '@youlin/contracts'

/**
 * 由 CONFIG_FIELDS 派生：
 *  - settingsZod：管理台写入校验（严格，拒绝未知键）
 *  - settingsJsonSchema：GET /api/admin/settings/schema 输出，前端据此渲染表单
 */

/** 主站地址允许 http(s) 或裸域名（backlink 一直支持这种写法），但拒绝 javascript: 等协议 */
const bareHost = z
  .string()
  .max(2000)
  .regex(/^[a-z0-9][a-z0-9.-]*(?::\d{1,5})?(?:\/.*)?$/i, '需为 http(s) URL 或域名')

/** 需要协议校验的配置项；其余 string 保持宽松（可为空/域名/前缀） */
const SPECIAL_SCHEMAS: Record<string, z.ZodType> = {
  'site.url': z.union([z.literal(''), httpUrl, bareHost]),
  'ui.accentColor': z.union([
    z.literal(''),
    z.string().regex(/^#[0-9a-fA-F]{6}$/, '强调色需为 #rrggbb 格式'),
  ]),
  'backup.webdavUrl': z
    .union([z.literal(''), httpUrl])
    .refine((v) => {
      if (!v) return true
      const u = new URL(v)
      return u.username === '' && u.password === ''
    }, 'WebDAV 地址不能包含账号密码：用户名单独填写，密码放 WEBDAV_PASSWORD'),
  'linkCheck.backoffLadder': z
    .array(z.tuple([z.number().int().min(0), z.number().int().min(1)]))
    .min(1)
    .refine((rows) => rows.every((row, i) => i === 0 || row[0] > rows[i - 1]![0]), '阶梯需按失联天数升序'),
  'site.logo': z.union([
    z.literal(''),
    httpUrl,
    z.string().regex(/^\/[^/]/, '站内路径需以 / 开头'),
    z.string().regex(/^data:image\/[a-z0-9.+-]+;base64,/i, '仅支持 http(s)、站内路径或 data:image'),
  ]),
}

function fieldZod(f: ConfigField): z.ZodType {
  const special = SPECIAL_SCHEMAS[f.key]
  if (special) return special
  switch (f.type) {
    case 'boolean':
      return z.boolean()
    case 'number': {
      let s = z.number().int('需为整数')
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

/** 严格校验：未知键、类型不符都报错（完整配置对象用） */
export const settingsZod = z.object(shape).strict()

/** 设置导入：允许旧版导出缺少后续新增的键（缺失项回退默认值），未知键仍拒绝 */
export const settingsImportZod = z.object(shape).partial().strict()

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

export function settingsSchemaPayload(): SettingsSchemaResponse {
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
