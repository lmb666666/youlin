import { z } from 'zod'

export const importErrorSchema = z.object({
  index: z.number().int(),
  message: z.string(),
})

export const importResultSchema = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  groupsCreated: z.number().int(),
  errors: z.array(importErrorSchema),
})

export type ImportError = z.infer<typeof importErrorSchema>
export type ImportResult = z.infer<typeof importResultSchema>
