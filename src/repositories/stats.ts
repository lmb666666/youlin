import { and, count, eq, isNull, lte, max, or, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { applications, articles, friends, sourceState } from '../server/schema'
import type { Db } from '../types'

export function adminStats(db: Db) {
  const orm = getOrm(db)
  const active = eq(friends.status, 'active')
  const activeCircle = and(active, eq(friends.inCircle, 1))

  const friendsActive = orm.select({ n: count() }).from(friends).where(active).get()?.n ?? 0
  const friendsHidden = orm.select({ n: count() }).from(friends).where(eq(friends.status, 'hidden')).get()?.n ?? 0
  const circleSources =
    orm
      .select({ n: count() })
      .from(friends)
      .where(and(activeCircle, sql`${friends.feed} IS NOT NULL`))
      .get()?.n ?? 0
  const articleRow = orm
    .select({ n: count(), lastArticleAt: max(articles.fetchedAt) })
    .from(articles)
    .get()
  const applicationsPending =
    orm.select({ n: count() }).from(applications).where(eq(applications.status, 'pending')).get()?.n ?? 0
  const applicationsTotal = orm.select({ n: count() }).from(applications).get()?.n ?? 0
  const unreachable =
    orm
      .select({ n: count() })
      .from(friends)
      .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
      .where(and(active, eq(sourceState.reachable, 0)))
      .get()?.n ?? 0
  const due =
    orm
      .select({ n: count() })
      .from(friends)
      .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
      .where(and(active, or(isNull(sourceState.nextCheckAt), lte(sourceState.nextCheckAt, sql`datetime('now')`))))
      .get()?.n ?? 0

  return {
    friendsActive: Number(friendsActive),
    friendsHidden: Number(friendsHidden),
    circleSources: Number(circleSources),
    articles: Number(articleRow?.n ?? 0),
    lastArticleAt: articleRow?.lastArticleAt ?? null,
    applicationsPending: Number(applicationsPending),
    applicationsTotal: Number(applicationsTotal),
    friendsUnreachable: Number(unreachable),
    sourcesDue: Number(due),
  }
}
