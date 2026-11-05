import { eq, inArray, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { friends, groups } from '../server/schema'
import type { Db } from '../types'

/** 已归一化的导入条目；缺省字段用 undefined 区分“保留旧值” */
export interface ImportFriendInput {
  group: string | undefined
  author: string
  authorProvided: boolean
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
  inCircle: boolean | undefined
  status: 'active' | 'hidden' | undefined
}

export interface ImportResult {
  imported: number
  updated: number
  groupsCreated: number
}

const CHUNK = 100

/**
 * 导入友链：分组按名补齐、友链按 link upsert。
 * 整个导入在一个事务里，失败时不会留下“建了分组但没导入友链”的半成品。
 */
export function importFriends(db: Db, items: ImportFriendInput[]): ImportResult {
  const defaultGroup = '未分组'
  return getOrm(db).transaction((tx) => {
    const groupIdByName = new Map(
      tx.select({ id: groups.id, name: groups.name }).from(groups).all().map((g) => [g.name, g.id]),
    )
    const missing = [...new Set(items.map((it) => it.group ?? defaultGroup))].filter((n) => !groupIdByName.has(n))
    const nextSort = groupIdByName.size
    let groupsCreated = 0

    if (missing.length > 0) {
      const created = tx
        .insert(groups)
        .values(missing.map((name, i) => ({ name, sort: nextSort + i })))
        .onConflictDoNothing({ target: groups.name })
        .returning({ id: groups.id, name: groups.name })
        .all()
      for (const g of created) groupIdByName.set(g.name, g.id)
      groupsCreated = created.length

      // 唯一索引兜住并发；仍查不到说明插入失败
      for (const name of missing) {
        if (groupIdByName.has(name)) continue
        const row = tx.select({ id: groups.id }).from(groups).where(eq(groups.name, name)).get()
        if (!row) throw new Error(`分组「${name}」创建失败`)
        groupIdByName.set(name, row.id)
      }
    }

    const existed = new Set<string>()
    const links = items.map((it) => it.link)
    for (let i = 0; i < links.length; i += CHUNK) {
      const chunk = links.slice(i, i + CHUNK)
      for (const row of tx.select({ link: friends.link }).from(friends).where(inArray(friends.link, chunk)).all()) {
        existed.add(row.link)
      }
    }

    const sortBase = new Map<number, number>()
    const targetGroupIds = [...new Set(items.map((it) => groupIdByName.get(it.group ?? defaultGroup)!))]
    for (let i = 0; i < targetGroupIds.length; i += CHUNK) {
      const chunk = targetGroupIds.slice(i, i + CHUNK)
      const rows = tx
        .select({
          groupId: friends.groupId,
          next: sql<number>`COALESCE(MAX(${friends.sort}), -1) + 1`,
        })
        .from(friends)
        .where(inArray(friends.groupId, chunk))
        .groupBy(friends.groupId)
        .all()
      for (const row of rows) sortBase.set(row.groupId, row.next)
    }
    const sortCursor = new Map<number, number>()
    const nextSortFor = (gid: number) => {
      const cur = sortCursor.get(gid) ?? sortBase.get(gid) ?? 0
      sortCursor.set(gid, cur + 1)
      return cur
    }

    let imported = 0
    let updated = 0
    const seen = new Set<string>()
    for (const it of items) {
      const groupId = groupIdByName.get(it.group ?? defaultGroup)!
      const isUpdate = existed.has(it.link) || seen.has(it.link)
      seen.add(it.link)
      if (isUpdate) updated++
      else imported++

      const flag = (on: boolean) => (on ? 1 : 0)
      tx.insert(friends)
        .values({
          groupId,
          author: it.author,
          nickname: it.nickname,
          title: it.title,
          desc: it.desc,
          link: it.link,
          feed: it.feed,
          icon: it.icon,
          avatar: it.avatar,
          archs: it.archs,
          since: it.since,
          comment: it.comment,
          inCircle: it.inCircle === undefined ? 1 : it.inCircle ? 1 : 0,
          status: it.status ?? 'active',
          sort: nextSortFor(groupId),
        })
        .onConflictDoUpdate({
          target: friends.link,
          set: {
            author: sql`CASE WHEN ${flag(it.authorProvided)} THEN excluded.author ELSE author END`,
            nickname: sql`COALESCE(excluded.nickname, nickname)`,
            title: sql`COALESCE(excluded.title, title)`,
            desc: sql`COALESCE(excluded."desc", "desc")`,
            feed: sql`COALESCE(excluded.feed, feed)`,
            icon: sql`COALESCE(excluded.icon, icon)`,
            avatar: sql`COALESCE(excluded.avatar, avatar)`,
            archs: sql`COALESCE(excluded.archs, archs)`,
            comment: sql`COALESCE(excluded.comment, comment)`,
            inCircle: sql`CASE WHEN ${flag(it.inCircle !== undefined)} THEN excluded.in_circle ELSE in_circle END`,
            groupId: sql`CASE WHEN ${flag(it.group !== undefined)} THEN excluded.group_id ELSE group_id END`,
            status: sql`CASE WHEN ${flag(it.status !== undefined)} THEN excluded.status ELSE status END`,
            updatedAt: sql`datetime('now')`,
          },
        })
        .run()
    }

    return { imported, updated, groupsCreated }
  })
}
