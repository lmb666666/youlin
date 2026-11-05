import { z } from 'zod'

export const sourceStateSchema = z.object({
  reachable: z.boolean().nullable(),
  crawlable: z.boolean().nullable(),
  bestMethod: z.enum(['rss', 'homepage', 'api', 'none']).nullable(),
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  finalUrl: z.string().nullable(),
  backlinkChecked: z.boolean(),
  backlink: z.boolean().nullable(),
  unreachableSince: z.string().nullable(),
  rssUnavailableSince: z.string().nullable(),
  lastPostPublished: z.string().nullable(),
  lastPostDaysAgo: z.number().int().nullable(),
  lastOkAt: z.string().nullable(),
  lastError: z.string().nullable(),
  failCount: z.number().int(),
  nextCheckAt: z.string().nullable(),
  checkedAt: z.string().nullable(),
})

export const healthFriendSchema = z.object({
  id: z.number().int(),
  author: z.string(),
  title: z.string().optional(),
  link: z.string(),
  feed: z.string().optional(),
  inCircle: z.boolean(),
  status: z.enum(['active', 'hidden']),
  state: sourceStateSchema.nullable(),
})

export const healthListResponseSchema = z.object({ friends: z.array(healthFriendSchema) })

export const articleRowSchema = z.object({
  id: z.number().int(),
  friendId: z.number().int(),
  friendAuthor: z.string(),
  title: z.string(),
  link: z.string(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  fetchedAt: z.string().optional(),
})

export const articleListResponseSchema = z.object({ articles: z.array(articleRowSchema) })

export const crawlStatusSchema = z.object({
  running: z.boolean(),
  /** 上次轮转超过最长存活时间仍未结束（进程被杀/部署中断） */
  stale: z.boolean(),
  round: z
    .object({
      kind: z.string(),
      startedAt: z.string(),
      done: z.number().int(),
      total: z.number().int(),
      finishedAt: z.string().optional(),
    })
    .nullable(),
  activeCount: z.number().int(),
  dueCount: z.number().int(),
})

export const probeResultSchema = z.object({
  feed: z.string().optional(),
  title: z.string().optional(),
  icon: z.string().optional(),
  avatar: z.string().optional(),
})

export const probeInputSchema = z.object({
  link: z.string(),
  feed: z.string().optional().nullable(),
})

export type SourceState = z.infer<typeof sourceStateSchema>
export type HealthFriend = z.infer<typeof healthFriendSchema>
export type HealthListResponse = z.infer<typeof healthListResponseSchema>
export type ArticleRow = z.infer<typeof articleRowSchema>
export type ArticleListResponse = z.infer<typeof articleListResponseSchema>
export type CrawlStatus = z.infer<typeof crawlStatusSchema>
export type ProbeResult = z.infer<typeof probeResultSchema>
export type ProbeInput = z.infer<typeof probeInputSchema>
