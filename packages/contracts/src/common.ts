import { z } from 'zod'

/** 校验 YYYY-MM-DD 是真实存在的日历日（拒绝 2024-02-30 / 2024-13-01） */
export function isRealYMD(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/** http(s) URL */
export const httpUrl = z
  .string()
  .max(2048)
  .refine(
    (v) => {
      try {
        const u = new URL(v)
        return u.protocol === 'http:' || u.protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: '链接需以 http:// 或 https:// 开头' },
  )

export const dateYMD = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD')
  .refine(isRealYMD, '日期不存在')

export const idSchema = z.number().int()

/** 管理 API 通用错误响应 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type ApiErrorBody = z.infer<typeof apiErrorSchema>
