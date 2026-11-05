import { asc, eq, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { articles, friends, groups, sourceState } from '../server/schema'
import type { Db } from '../types'

export interface AdminFriendRow {
  id: number
  groupId: number
  groupName: string
  author: string
  nickname: string | null
  title: string | null
  desc: string | null
  link: string
  feed: string | null
  icon: string | null
  avatar: string | null
  archs: string[] | null
  since: string
  comment: string | null
  inCircle: boolean
  status: string
  sort: number
  createdAt: string
  updatedAt: string
  reachable: number | null
  crawlable: number | null
  failCount: number | null
  checkedAt: string | null
}

export interface CreateFriendInput {
  groupId: number
  author: string
  nickname?: string | null
  title: string
  desc?: string | null
  link: string
  feed?: string | null
  icon?: string | null
  avatar?: string | null
  archs?: string[]
  since: string
  comment?: string | null
  inCircle?: boolean
  status?: 'active' | 'hidden'
  sort?: number
}

export interface UpdateFriendInput {
  groupId?: number
  author?: string
  nickname?: string | null
  title?: string
  desc?: string | null
  link?: string
  feed?: string | null
  icon?: string | null
  avatar?: string | null
  archs?: string[]
  since?: string
  comment?: string | null
  inCircle?: boolean
  status?: 'active' | 'hidden'
  sort?: number
}

export function nextFriendSort(db: Db, groupId: number): number {
  const row = getOrm(db)
    .select({ next: sql<number>`COALESCE(MAX(${friends.sort}), -1) + 1` })
    .from(friends)
    .where(eq(friends.groupId, groupId))
    .get()
  return row?.next ?? 0
}

export function listFriends(db: Db): AdminFriendRow[] {
  return getOrm(db)
    .select({
      id: friends.id,
      groupId: friends.groupId,
      groupName: groups.name,
      author: friends.author,
      nickname: friends.nickname,
      title: friends.title,
      desc: friends.desc,
      link: friends.link,
      feed: friends.feed,
      icon: friends.icon,
      avatar: friends.avatar,
      archs: friends.archs,
      since: friends.since,
      comment: friends.comment,
      inCircle: friends.inCircle,
      status: friends.status,
      sort: friends.sort,
      createdAt: friends.createdAt,
      updatedAt: friends.updatedAt,
      reachable: sourceState.reachable,
      crawlable: sourceState.crawlable,
      failCount: sourceState.failCount,
      checkedAt: sourceState.checkedAt,
    })
    .from(friends)
    .innerJoin(groups, eq(groups.id, friends.groupId))
    .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
    .orderBy(asc(groups.sort), asc(groups.id), asc(friends.sort), asc(friends.id))
    .all()
    .map((row) => ({ ...row, inCircle: row.inCircle === 1 }))
}

export function findFriendById(db: Db, id: number) {
  return getOrm(db).select().from(friends).where(eq(friends.id, id)).get() ?? null
}

export function friendLinkExists(db: Db, link: string): boolean {
  return Boolean(getOrm(db).select({ id: friends.id }).from(friends).where(eq(friends.link, link)).get())
}

export function createFriend(db: Db, input: CreateFriendInput): number {
  const row = getOrm(db)
    .insert(friends)
    .values({
      groupId: input.groupId,
      author: input.author,
      nickname: input.nickname ?? null,
      title: input.title,
      desc: input.desc ?? null,
      link: input.link,
      feed: input.feed ?? null,
      icon: input.icon ?? null,
      avatar: input.avatar ?? null,
      archs: input.archs ?? null,
      since: input.since,
      comment: input.comment ?? null,
      inCircle: input.inCircle === false ? 0 : 1,
      status: input.status ?? 'active',
      sort: input.sort ?? nextFriendSort(db, input.groupId),
    })
    .returning({ id: friends.id })
    .get()
  return row.id
}

export function updateFriend(db: Db, id: number, patch: UpdateFriendInput): void {
  const values: Record<string, unknown> = { updatedAt: sql`datetime('now')` }
  if (patch.groupId !== undefined) values.groupId = patch.groupId
  if (patch.author !== undefined) values.author = patch.author
  if (patch.nickname !== undefined) values.nickname = patch.nickname
  if (patch.title !== undefined) values.title = patch.title
  if (patch.desc !== undefined) values.desc = patch.desc
  if (patch.link !== undefined) values.link = patch.link
  if (patch.feed !== undefined) values.feed = patch.feed
  if (patch.icon !== undefined) values.icon = patch.icon
  if (patch.avatar !== undefined) values.avatar = patch.avatar
  if (patch.archs !== undefined) values.archs = patch.archs
  if (patch.since !== undefined) values.since = patch.since
  if (patch.comment !== undefined) values.comment = patch.comment
  if (patch.inCircle !== undefined) values.inCircle = patch.inCircle ? 1 : 0
  if (patch.status !== undefined) values.status = patch.status
  if (patch.sort !== undefined) values.sort = patch.sort
  getOrm(db).update(friends).set(values as Partial<typeof friends.$inferInsert>).where(eq(friends.id, id)).run()
}

export function deleteFriend(db: Db, id: number): void {
  getOrm(db).transaction((tx) => {
    tx.delete(articles).where(eq(articles.friendId, id)).run()
    tx.delete(sourceState).where(eq(sourceState.friendId, id)).run()
    tx.delete(friends).where(eq(friends.id, id)).run()
  })
}

export function reorderFriends(db: Db, items: { id: number; sort: number; groupId?: number }[]): void {
  getOrm(db).transaction((tx) => {
    for (const item of items) {
      tx.update(friends)
        .set({
          sort: item.sort,
          ...(item.groupId === undefined ? {} : { groupId: item.groupId }),
          updatedAt: sql`datetime('now')`,
        })
        .where(eq(friends.id, item.id))
        .run()
    }
  })
}
