import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonError, fieldDetails, isUniqueConstraintError, readJson } from '../../util/http'
import { httpUrl, dateYMD } from '../../util/validate'
import { isoUtc } from '../../util/time'
import { triggerRebuild } from '../../rebuild'
import { runInBackground } from '../../util/bg'
import {
  createFriend,
  deleteFriend,
  findFriendById,
  friendLinkExists,
  listFriends,
  reorderFriends,
  updateFriend,
  type UpdateFriendInput,
} from '../../repositories/friends'
import { findGroupById } from '../../repositories/groups'
import type { AppEnv } from '../../types'

/** rebuild.auto 时数据变化后触发接入方重建（不阻塞响应） */
function maybeAutoRebuild(c: Context<AppEnv>, reason: string): void {
  const cfg = c.get('cfg')
  if (cfg.rebuild.enabled && cfg.rebuild.auto) {
    runInBackground(c, triggerRebuild(c.env, cfg, reason))
  }
}

const friendInput = z.object({
  groupId: z.number().int().positive(),
  // 站点名必填；作者选填，缺省时后端用站点名兜底（保持 author 列 NOT NULL 与公开契约不变）
  title: z.string().min(1).max(200),
  author: z.string().max(200).optional().nullable(),
  nickname: z.string().max(200).optional().nullable(),
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
const friendPatch = friendInput.partial().extend({
  // 这四列 NOT NULL，不接受 null（author 的空串由兜底逻辑转换）
  groupId: z.number().int().positive().optional(),
  author: z.string().max(200).optional(),
  link: httpUrl.optional(),
  since: dateYMD.optional(),
})

export function friendRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/friends', async (c) => {
    return c.json({
      friends: listFriends(c.env.DB).map((f) => ({
        id: f.id,
        groupId: f.groupId,
        groupName: f.groupName,
        author: f.author,
        nickname: f.nickname ?? undefined,
        title: f.title ?? undefined,
        desc: f.desc ?? undefined,
        link: f.link,
        feed: f.feed ?? undefined,
        icon: f.icon ?? undefined,
        avatar: f.avatar ?? undefined,
        archs: f.archs ?? undefined,
        since: f.since,
        comment: f.comment ?? undefined,
        inCircle: f.inCircle,
        status: f.status,
        sort: f.sort,
        createdAt: isoUtc(f.createdAt),
        updatedAt: isoUtc(f.updatedAt),
        state:
          f.checkedAt == null
            ? null
            : {
                reachable: f.reachable == null ? null : f.reachable === 1,
                crawlable: f.crawlable == null ? null : f.crawlable === 1,
                failCount: f.failCount ?? 0,
                checkedAt: isoUtc(f.checkedAt),
              },
      })),
    })
  })

  app.post('/api/admin/friends', async (c) => {
    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')
    const parsed = friendInput.safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    const d = parsed.data

    if (!findGroupById(c.env.DB, d.groupId)) return jsonError(400, 'unknown_group', '分组不存在')
    const author = d.author && d.author.trim() !== '' ? d.author.trim() : d.title

    try {
      const id = createFriend(c.env.DB, {
        groupId: d.groupId,
        author,
        nickname: d.nickname,
        title: d.title,
        desc: d.desc,
        link: d.link,
        feed: d.feed,
        icon: d.icon,
        avatar: d.avatar,
        archs: d.archs,
        since: d.since,
        comment: d.comment,
        inCircle: d.inCircle,
        status: d.status,
        sort: d.sort,
      })
      maybeAutoRebuild(c, 'friend:create')
      return c.json({ id }, 201)
    } catch (e) {
      if (isUniqueLinkError(c, e, d.link)) return jsonError(409, 'duplicate_link', '该链接已存在')
      throw e
    }
  })

  app.patch('/api/admin/friends/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')
    const parsed = friendPatch.safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    const d = parsed.data
    const existing = findFriendById(c.env.DB, id)
    if (!existing) return jsonError(404, 'not_found', '友链不存在')
    if (d.groupId !== undefined && !findGroupById(c.env.DB, d.groupId)) {
      return jsonError(400, 'unknown_group', '分组不存在')
    }

    const patch: UpdateFriendInput = {}
    if (d.groupId !== undefined) patch.groupId = d.groupId
    if (d.nickname !== undefined) patch.nickname = d.nickname
    if (d.title !== undefined) patch.title = d.title
    if (d.desc !== undefined) patch.desc = d.desc
    if (d.link !== undefined) patch.link = d.link
    if (d.feed !== undefined) patch.feed = d.feed
    if (d.icon !== undefined) patch.icon = d.icon
    if (d.avatar !== undefined) patch.avatar = d.avatar
    if (d.since !== undefined) patch.since = d.since
    if (d.comment !== undefined) patch.comment = d.comment
    if (d.status !== undefined) patch.status = d.status
    if (d.sort !== undefined) patch.sort = d.sort
    if (d.archs !== undefined) patch.archs = d.archs
    if (d.inCircle !== undefined) patch.inCircle = d.inCircle

    if (d.author !== undefined) {
      if (d.author.trim() === '') {
        // 作者清空 → 用站点名兜底（新提交的 title 优先，其次原值）
        const fallback = d.title ?? existing.title
        if (!fallback || fallback.trim() === '') {
          return jsonError(400, 'author_required', '作者与站点名不能同时为空')
        }
        patch.author = fallback.trim()
      } else {
        patch.author = d.author
      }
    }

    try {
      updateFriend(c.env.DB, id, patch)
    } catch (e) {
      if (isUniqueLinkError(c, e, d.link)) return jsonError(409, 'duplicate_link', '该链接已存在')
      throw e
    }
    maybeAutoRebuild(c, 'friend:update')
    return c.json({ ok: true })
  })

  app.delete('/api/admin/friends/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    deleteFriend(c.env.DB, id)
    maybeAutoRebuild(c, 'friend:delete')
    return c.json({ ok: true })
  })

  // 拖拽排序：批量写入新 sort（可选同时改分组）
  app.post('/api/admin/friends/reorder', async (c) => {
    const body = await readJson(c)
    const parsed = z
      .object({ items: z.array(z.object({ id: z.number().int(), sort: z.number().int(), groupId: z.number().int().optional() })).min(1) })
      .safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    reorderFriends(c.env.DB, parsed.data.items)
    return c.json({ ok: true })
  })

  return app
}

/** 唯一键冲突是否来自 friends.link（而非其他索引） */
function isUniqueLinkError(c: Context<AppEnv>, err: unknown, link?: string): boolean {
  if (!isUniqueConstraintError(err)) return false
  return link === undefined ? true : friendLinkExists(c.env.DB, link)
}
