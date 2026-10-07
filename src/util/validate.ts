import { z } from 'zod'

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

export const dateYMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD')
