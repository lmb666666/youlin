import { and, count, countDistinct, desc, eq, isNotNull, max, or, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { articles, friends, sourceState } from '../server/schema'
import type { Db } from '../types'

export interface CircleStats {
  friends: number
  active: number
  failed: number
  articles: number
  updatedAt: string | null
}

export interface CircleArticle {
  title: string
  link: string
  author: string | null
  publishedAt: string
  avatar: string | null
}

const participating = and(eq(friends.status, 'active'), eq(friends.inCircle, 1), isNotNull(friends.feed))
const circleGate = and(eq(friends.status, 'active'), eq(friends.inCircle, 1))

export function circleStats(db: Db): CircleStats {
  const orm = getOrm(db)
  const friendsRow = orm.select({ n: count() }).from(friends).where(participating).get()
  const failedRow = orm
    .select({ n: count() })
    .from(friends)
    .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
    .where(and(participating, or(eq(sourceState.reachable, 0), eq(sourceState.crawlable, 0))))
    .get()
  const articleRow = orm
    .select({ n: count(), distinctFriends: countDistinct(articles.friendId), updatedAt: max(articles.fetchedAt) })
    .from(articles)
    .innerJoin(friends, eq(friends.id, articles.friendId))
    .where(circleGate)
    .get()

  return {
    friends: Number(friendsRow?.n ?? 0),
    active: Number(articleRow?.distinctFriends ?? 0),
    failed: Number(failedRow?.n ?? 0),
    articles: Number(articleRow?.n ?? 0),
    updatedAt: articleRow?.updatedAt ?? null,
  }
}

export function listCircleArticles(db: Db, limit: number): CircleArticle[] {
  return getOrm(db)
    .select({
      title: articles.title,
      link: articles.link,
      author: articles.author,
      publishedAt: articles.publishedAt,
      avatar: friends.avatar,
    })
    .from(articles)
    .innerJoin(friends, eq(friends.id, articles.friendId))
    .where(circleGate)
    .orderBy(sql`datetime(${articles.publishedAt}) DESC`, desc(articles.id))
    .limit(limit)
    .all()
}
