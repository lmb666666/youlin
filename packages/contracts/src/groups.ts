import { z } from 'zod'

export const groupCreateSchema = z.object({
  name: z.string().min(1, '请填写分组名称').max(100, '分组名称不能超过 100 字'),
  desc: z.string().max(2000).optional().nullable(),
  sort: z.number().int().min(0).optional(),
})

export const groupUpdateSchema = groupCreateSchema.partial()

export const groupReorderSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), sort: z.number().int().min(0) })).min(1),
})

export const groupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  desc: z.string().optional(),
  sort: z.number().int(),
  friendCount: z.number().int(),
})

export const groupListResponseSchema = z.object({ groups: z.array(groupSchema) })

export type GroupCreateInput = z.infer<typeof groupCreateSchema>
export type GroupUpdateInput = z.infer<typeof groupUpdateSchema>
export type GroupReorderInput = z.infer<typeof groupReorderSchema>
export type Group = z.infer<typeof groupSchema>
export type GroupListResponse = z.infer<typeof groupListResponseSchema>
