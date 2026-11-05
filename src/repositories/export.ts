import { asc, eq } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { friends, groups } from '../server/schema'
import type { Db } from '../types'

/** 导出视图：分组 LEFT JOIN 友链，保留空分组；顺序与管理台一致 */
export function listExportRows(db: Db) {
  return getOrm(db)
    .select({
      groupName: groups.name,
      groupDesc: groups.desc,
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
      createdAt: friends.createdAt,
    })
    .from(groups)
    .leftJoin(friends, eq(friends.groupId, groups.id))
    .orderBy(asc(groups.sort), asc(groups.id), asc(friends.sort), asc(friends.id))
    .all()
}
