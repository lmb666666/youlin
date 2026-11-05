import { z } from 'zod'

export const loginSchema = z.object({
  token: z.string().min(1, '请输入管理口令').max(4096),
})

export type LoginInput = z.infer<typeof loginSchema>
