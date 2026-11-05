import { z } from 'zod'
import { dateYMD, httpUrl } from './common'

export const friendStateSchema = z.object({
  reachable: z.boolean().nullable(),
  crawlable: z.boolean().nullable(),
  failCount: z.number().int(),
  checkedAt: z.string().optional(),
})

export const friendSchema = z.object({
  id: z.number().int(),
  groupId: z.number().int(),
  groupName: z.string().optional(),
  author: z.string(),
  nickname: z.string().optional(),
  title: z.string().optional(),
  desc: z.string().optional(),
  link: z.string(),
  feed: z.string().optional(),
  icon: z.string().optional(),
  avatar: z.string().optional(),
  archs: z.array(z.string()).optional(),
  since: z.string(),
  comment: z.string().optional(),
  inCircle: z.boolean(),
  status: z.enum(['active', 'hidden']),
  sort: z.number().int(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  state: friendStateSchema.nullable().optional(),
})

export const friendCreateSchema = z.object({
  groupId: z.number().int().positive('请选择分组'),
  // 站点名必填；作者选填，缺省时后端用站点名兜底（保持 author 列 NOT NULL 与公开契约不变）
  title: z.string().min(1, '请填写站点名').max(200, '站点名不能超过 200 字'),
  author: z.string().max(200, '作者名不能超过 200 字').optional().nullable(),
  nickname: z.string().max(200, '趣称不能超过 200 字').optional().nullable(),
  desc: z.string().max(2000).optional().nullable(),
  link: httpUrl,
  feed: httpUrl.optional().nullable(),
  icon: httpUrl.optional().nullable(),
  avatar: httpUrl.optional().nullable(),
  archs: z.array(z.string().max(100)).max(20).optional(),
  since: dateYMD,
  comment: z.string().max(2000).optional().nullable(),
  inCircle: z.boolean().optional(),
  status: z.enum(['active', 'hidden']).optional(),
  sort: z.number().int().optional(),
})

export const friendPatchSchema = friendCreateSchema.partial().extend({
  // 这四列 NOT NULL，不接受 null（author 的空串由兜底逻辑转换）
  groupId: z.number().int().positive().optional(),
  author: z.string().max(200).optional(),
  link: httpUrl.optional(),
  since: dateYMD.optional(),
})

export const friendReorderSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), sort: z.number().int(), groupId: z.number().int().optional() })).min(1),
})

export const friendListResponseSchema = z.object({ friends: z.array(friendSchema) })

export type FriendState = z.infer<typeof friendStateSchema>
export type Friend = z.infer<typeof friendSchema>
export type FriendCreateInput = z.infer<typeof friendCreateSchema>
export type FriendPatchInput = z.infer<typeof friendPatchSchema>
export type FriendReorderInput = z.infer<typeof friendReorderSchema>
export type FriendListResponse = z.infer<typeof friendListResponseSchema>
