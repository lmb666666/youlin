import { z } from 'zod'
import { httpUrl } from './common'

const optionalUrl = z.union([httpUrl, z.literal('')]).optional().nullable()
const optionalText = (max: number) => z.union([z.string().max(max), z.literal('')]).optional().nullable()

export const applyFormSchema = z
  .object({
    siteName: optionalText(100),
    // link 容忍缺省/空串：必填与格式提示由服务端统一转成中文
    link: z.preprocess((v) => (v === '' ? undefined : v), httpUrl.optional()),
    author: optionalText(100),
    avatar: optionalUrl,
    feed: optionalUrl,
    desc: optionalText(2000),
    contact: optionalText(200),
    note: optionalText(2000),
    turnstileToken: z.string().max(4000).optional().nullable(),
  })
  .strict()

export const backlinkVerdictSchema = z.object({
  ok: z.boolean().nullable(),
  detail: z.string().nullable(),
})

export const applyResultSchema = z.object({
  id: z.number().int(),
  status: z.enum(['pending', 'approved']),
  backlink: backlinkVerdictSchema,
})

export type ApplyFormInput = z.infer<typeof applyFormSchema>
export type BacklinkVerdict = z.infer<typeof backlinkVerdictSchema>
export type ApplyResult = z.infer<typeof applyResultSchema>
