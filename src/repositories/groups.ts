import { asc, count, eq, inArray, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { articles, friends, groups, sourceState } from '../server/schema'
import type { Db } from '../types'

export interface GroupWithCount {
  id: number
  name: string
  desc: string | null
  sort: number
  friendCount: number
}

export function listGroups(db: Db): GroupWithCount[] {
  const rows = getOrm(db)
    .select({
      id: groups.id,
      name: groups.name,
      desc: groups.desc,
      sort: groups.sort,
      friendCount: count(friends.id),
    })
    .from(groups)
    .leftJoin(friends, eq(friends.groupId, groups.id))
    .groupBy(groups.id)
    .orderBy(asc(groups.sort), asc(groups.id))
    .all()
  return rows.map((g) => ({ ...g, friendCount: Number(g.friendCount) }))
}

export function findGroupById(db: Db, id: number) {
  return getOrm(db).select().from(groups).where(eq(groups.id, id)).get() ?? null
}

export function findGroupByName(db: Db, name: string) {
  return getOrm(db).select().from(groups).where(eq(groups.name, name)).get() ?? null
}

export function groupNameTaken(db: Db, name: string, excludeId?: number) {
  const where = excludeId === undefined ? eq(groups.name, name) : sql`${groups.name} = ${name} AND ${groups.id} != ${excludeId}`
  return Boolean(getOrm(db).select({ id: groups.id }).from(groups).where(where).get())
}

function nextSort(db: Db): number {
  const row = getOrm(db)
    .select({ next: sql<number>`COALESCE(MAX(${groups.sort}), -1) + 1` })
    .from(groups)
    .get()
  return row?.next ?? 0
}

export function createGroup(db: Db, input: { name: string; desc?: string | null; sort?: number }): number {
  const row = getOrm(db)
    .insert(groups)
    .values({ name: input.name, desc: input.desc ?? null, sort: input.sort ?? nextSort(db) })
    .returning({ id: groups.id })
    .get()
  return row.id
}

export function updateGroup(db: Db, id: number, patch: { name?: string; desc?: string | null; sort?: number }): void {
  const values: Partial<typeof groups.$inferInsert> = {}
  if (patch.name !== undefined) values.name = patch.name
  if (patch.desc !== undefined) values.desc = patch.desc
  if (patch.sort !== undefined) values.sort = patch.sort
  if (Object.keys(values).length === 0) return
  getOrm(db).update(groups).set(values).where(eq(groups.id, id)).run()
}

/** 分组删除：显式清理友链派生数据，不依赖外键级联 */
export function deleteGroupCascade(db: Db, id: number): void {
  getOrm(db).transaction((tx) => {
    tx.delete(articles)
      .where(inArray(articles.friendId, tx.select({ id: friends.id }).from(friends).where(eq(friends.groupId, id))))
      .run()
    tx.delete(sourceState)
      .where(inArray(sourceState.friendId, tx.select({ id: friends.id }).from(friends).where(eq(friends.groupId, id))))
      .run()
    tx.delete(friends).where(eq(friends.groupId, id)).run()
    tx.delete(groups).where(eq(groups.id, id)).run()
  })
}

export function reorderGroups(db: Db, items: { id: number; sort: number }[]): void {
  getOrm(db).transaction((tx) => {
    for (const item of items) {
      tx.update(groups).set({ sort: item.sort }).where(eq(groups.id, item.id)).run()
    }
  })
}

/** 申请通过/autoApprove 使用：按名称查或创建，唯一索引兜住并发 */
export function ensureGroupByName(db: Db, name: string): number {
  return getOrm(db).transaction((tx) => {
    const existing = tx.select({ id: groups.id }).from(groups).where(eq(groups.name, name)).get()
    if (existing) return existing.id
    const next =
      tx.select({ next: sql<number>`COALESCE(MAX(${groups.sort}), -1) + 1` }).from(groups).get()?.next ?? 0
    const inserted = tx
      .insert(groups)
      .values({ name, sort: next })
      .onConflictDoNothing({ target: groups.name })
      .returning({ id: groups.id })
      .get()
    if (inserted) return inserted.id
    const raced = tx.select({ id: groups.id }).from(groups).where(eq(groups.name, name)).get()
    if (!raced) throw new Error(`分组「${name}」创建失败`)
    return raced.id
  })
}

