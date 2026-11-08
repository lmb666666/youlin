import { z } from 'zod'

export const linkHealthSchema = z.object({
  reachable: z.boolean().optional(),
  crawlable: z.boolean().optional(),
  /** true/false；null=未检测 */
  backlink: z.boolean().nullable(),
  /** 秒；不可达为 -1 */
  latency: z.number().optional(),
  lastPostAt: z.string().optional(),
  staleDays: z.number().int().optional(),
  /** 失联天数；正常 null */
  unreachableDays: z.number().int().nullable(),
  checkedAt: z.string(),
})

export const linkOutputSchema = z.object({
  author: z.string(),
  title: z.string().optional(),
  desc: z.string().optional(),
  link: z.string(),
  feed: z.string().optional(),
  icon: z.string().optional(),
  avatar: z.string().optional(),
  archs: z.array(z.string()).optional(),
  since: z.string(),
  comment: z.string().optional(),
  health: linkHealthSchema.optional(),
})

export const publicGroupSchema = z.object({
  name: z.string(),
  desc: z.string().optional(),
  links: z.array(linkOutputSchema),
})

export const publicLinksResponseSchema = z.object({ groups: z.array(publicGroupSchema) })

export const circleArticleSchema = z.object({
  title: z.string(),
  link: z.string(),
  author: z.string().optional(),
  avatar: z.string().optional(),
  publishedAt: z.string(),
})

export const circleResponseSchema = z.object({
  stats: z.object({
    friends: z.number().int(),
    active: z.number().int(),
    failed: z.number().int(),
    articles: z.number().int(),
    updatedAt: z.string().nullable(),
  }),
  articles: z.array(circleArticleSchema),
})

export type LinkHealth = z.infer<typeof linkHealthSchema>
export type LinkOutput = z.infer<typeof linkOutputSchema>
export type PublicGroup = z.infer<typeof publicGroupSchema>
export type PublicLinksResponse = z.infer<typeof publicLinksResponseSchema>
export type CircleArticle = z.infer<typeof circleArticleSchema>
export type CircleResponse = z.infer<typeof circleResponseSchema>
