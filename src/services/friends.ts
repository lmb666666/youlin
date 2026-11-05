import { AppError } from '../errors'
import { friendCreateSchema, friendPatchSchema, friendReorderSchema, type Friend } from '@youlin/contracts'
import { parseInput } from './validation'
import { maybeAutoRebuild } from './rebuild'
import { isUniqueConstraintError } from '../util/http'
import { isoUtc } from '../util/time'
import { findGroupById } from '../repositories/groups'
import {
  createFriend as insertFriend,
  deleteFriend as removeFriend,
  findFriendById,
  friendLinkExists,
  listFriends,
  reorderFriends as writeFriendOrder,
  updateFriend as writeFriend,
  type UpdateFriendInput,
} from '../repositories/friends'
import type { AppConfig, Db, Env } from '../types'

export function listFriendViews(db: Db): Friend[] {
  return listFriends(db).map((f) => ({
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
    status: f.status === 'hidden' ? 'hidden' : 'active',
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
  }))
}

export function createFriend(db: Db, env: Env, cfg: AppConfig, raw: unknown): { id: number } {
  const d = parseInput(friendCreateSchema, raw)

  if (!findGroupById(db, d.groupId)) throw new AppError(400, 'unknown_group', '分组不存在')
  const author = d.author && d.author.trim() !== '' ? d.author.trim() : d.title

  try {
    const id = insertFriend(db, {
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
    maybeAutoRebuild(env, cfg, 'friend:create')
    return { id }
  } catch (e) {
    throwIfDuplicateLink(db, e, d.link)
    throw e
  }
}

export function updateFriend(db: Db, env: Env, cfg: AppConfig, id: number, raw: unknown): void {
  const d = parseInput(friendPatchSchema, raw)
  const existing = findFriendById(db, id)
  if (!existing) throw new AppError(404, 'not_found', '友链不存在')
  if (d.groupId !== undefined && !findGroupById(db, d.groupId)) {
    throw new AppError(400, 'unknown_group', '分组不存在')
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
        throw new AppError(400, 'author_required', '作者与站点名不能同时为空')
      }
      patch.author = fallback.trim()
    } else {
      patch.author = d.author
    }
  }

  try {
    writeFriend(db, id, patch)
  } catch (e) {
    throwIfDuplicateLink(db, e, d.link)
    throw e
  }
  maybeAutoRebuild(env, cfg, 'friend:update')
}

export function deleteFriend(db: Db, env: Env, cfg: AppConfig, id: number): void {
  removeFriend(db, id)
  maybeAutoRebuild(env, cfg, 'friend:delete')
}

export function reorderFriends(db: Db, raw: unknown): void {
  writeFriendOrder(db, parseInput(friendReorderSchema, raw).items)
}

/** 唯一键冲突且来自 friends.link 时抛 409；其他错误交给调用方原样抛出 */
function throwIfDuplicateLink(db: Db, err: unknown, link?: string): void {
  if (!isUniqueConstraintError(err)) return
  const fromLink = link === undefined ? true : friendLinkExists(db, link)
  if (fromLink) throw new AppError(409, 'duplicate_link', '该链接已存在')
}
