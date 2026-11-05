import { z } from 'zod'
import { dateYMD, httpUrl } from './common'

export const applicationStatusSchema = z.enum(['pending', 'approved', 'rejected'])

export const applicationSchema = z.object({
  id: z.number().int(),
  siteName: z.string(),
  author: z.string().optional(),
  link: z.string(),
  avatar: z.string().optional(),
  feed: z.string().optional(),
  desc: z.string().optional(),
  contact: z.string().optional(),
  note: z.string().optional(),
  backlink: z.object({
    ok: z.boolean().nullable(),
    checkedAt: z.string().nullable(),
    detail: z.string().nullable(),
  }),
  status: applicationStatusSchema,
  reviewNote: z.string().optional(),
  createdAt: z.string().optional(),
  reviewedAt: z.string().optional(),
})

export const applicationListResponseSchema = z.object({ applications: z.array(applicationSchema) })

export const applicationApproveSchema = z
  .object({
    groupId: z.number().int().positive().optional(),
    // 可编辑后再入库（DESIGN §7：字段自动填充，可编辑）
    author: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
    desc: z.string().max(2000).optional(),
    // 与 friends 表单同一校验口径（httpUrl），放行 javascript: 等任意 scheme 会流入公开接口
    feed: z.union([httpUrl, z.literal('')]).optional(),
    avatar: z.union([httpUrl, z.literal('')]).optional(),
    since: dateYMD.optional(),
    rebuild: z.boolean().optional(),
  })
  .strict()

export const applicationRejectSchema = z.object({ reason: z.string().max(2000).optional() }).strict()

export const manualRebuildSchema = z.object({ reason: z.string().max(200).optional() }).strict()

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>
export type Application = z.infer<typeof applicationSchema>
export type ApplicationListResponse = z.infer<typeof applicationListResponseSchema>
export type ApplicationApproveInput = z.infer<typeof applicationApproveSchema>
export type ApplicationRejectInput = z.infer<typeof applicationRejectSchema>
export type ManualRebuildInput = z.infer<typeof manualRebuildSchema>
