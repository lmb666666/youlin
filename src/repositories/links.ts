import { asc, eq } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { friends, groups, sourceState, type FriendRow, type SourceStateRow } from '../server/schema'
import type { Db } from '../types'

export interface PublicGroup {
  id: number
  name: string
  desc: string | null
  links: { friend: FriendRow; state: SourceStateRow | null }[]
}

export function listPublicGroups(db: Db, includeHidden: boolean, groupName?: string): PublicGroup[] {
  const orm = getOrm(db)
  const groupQuery = orm.select().from(groups).orderBy(asc(groups.sort), asc(groups.id))
  const groupRows =
    groupName === undefined ? groupQuery.all() : groupQuery.where(eq(groups.name, groupName)).all()

  const friendQuery = orm
    .select({ friend: friends, state: sourceState })
    .from(friends)
    .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
  const friendRows = (includeHidden ? friendQuery : friendQuery.where(eq(friends.status, 'active')))
    .orderBy(asc(friends.sort), asc(friends.id))
    .all()

  const byGroup = new Map<number, PublicGroup['links']>()
  for (const row of friendRows) {
    const list = byGroup.get(row.friend.groupId) ?? []
    list.push(row)
    byGroup.set(row.friend.groupId, list)
  }

  return groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    desc: g.desc,
    links: byGroup.get(g.id) ?? [],
  }))
}
