import { z } from 'zod'

export const adminStatsSchema = z.object({
  friends: z.object({
    active: z.number().int(),
    hidden: z.number().int(),
    unreachable: z.number().int(),
  }),
  circle: z.object({ sources: z.number().int(), due: z.number().int() }),
  articles: z.object({ total: z.number().int(), lastArticleAt: z.string().nullable() }),
  applications: z.object({ pending: z.number().int(), total: z.number().int() }),
})

export type AdminStats = z.infer<typeof adminStatsSchema>
