import { and, asc, count, desc, eq, isNull, lte, notInArray, or, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { articles, friends, sourceState } from '../server/schema'
import type { Db } from '../types'

/**
 * 抓取与体检的数据访问：到期选取、条件请求状态、文章增量、体检落库。
 * 时间比较统一走 SQLite datetime()，兼容历史空格格式。
 */

export interface CrawlFriend {
  id: number
  author: string
  link: string
  feed: string | null
  in_circle: number
}

export interface CrawlState {
  etag: string | null
  lastModified: string | null
}

export interface PriorCrawlState {
  unreachableSince: string | null
  rssUnavailableSince: string | null
  failCount: number
}

export function ensureStateRow(db: Db, friendId: number): void {
  getOrm(db).insert(sourceState).values({ friendId }).onConflictDoNothing().run()
}

export function findCrawlState(db: Db, friendId: number): CrawlState | null {
  return (
    getOrm(db)
      .select({ etag: sourceState.etag, lastModified: sourceState.lastModified })
      .from(sourceState)
      .where(eq(sourceState.friendId, friendId))
      .get() ?? null
  )
}

export function findPriorCrawlState(db: Db, friendId: number): PriorCrawlState | null {
  return (
    getOrm(db)
      .select({
        unreachableSince: sourceState.unreachableSince,
        rssUnavailableSince: sourceState.rssUnavailableSince,
        failCount: sourceState.failCount,
      })
      .from(sourceState)
      .where(eq(sourceState.friendId, friendId))
      .get() ?? null
  )
}

export function findUnreachableSince(db: Db, friendId: number): string | null {
  return (
    getOrm(db)
      .select({ unreachableSince: sourceState.unreachableSince })
      .from(sourceState)
      .where(eq(sourceState.friendId, friendId))
      .get()?.unreachableSince ?? null
  )
}

/** 本轮该抓的源：active 且 next_check_at 到期，最久未检查优先 */
export function selectDueSources(db: Db, limit: number): CrawlFriend[] {
  return getOrm(db)
    .select({
      id: friends.id,
      author: friends.author,
      link: friends.link,
      feed: friends.feed,
      in_circle: friends.inCircle,
    })
    .from(friends)
    .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
    .where(
      and(
        eq(friends.status, 'active'),
        or(isNull(sourceState.nextCheckAt), lte(sourceState.nextCheckAt, sql`datetime('now')`)),
      ),
    )
    .orderBy(asc(sourceState.checkedAt), asc(friends.id))
    .limit(limit)
    .all()
}

export function listActiveFriends(db: Db): CrawlFriend[] {
  return getOrm(db)
    .select({
      id: friends.id,
      author: friends.author,
      link: friends.link,
      feed: friends.feed,
      in_circle: friends.inCircle,
    })
    .from(friends)
    .where(eq(friends.status, 'active'))
    .orderBy(asc(friends.id))
    .all()
}

export function countActiveFriends(db: Db): number {
  return Number(getOrm(db).select({ n: count() }).from(friends).where(eq(friends.status, 'active')).get()?.n ?? 0)
}

export function countDueFriends(db: Db): number {
  return Number(
    getOrm(db)
      .select({ n: count() })
      .from(friends)
      .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
      .where(
        and(
          eq(friends.status, 'active'),
          or(isNull(sourceState.nextCheckAt), lte(sourceState.nextCheckAt, sql`datetime('now')`)),
        ),
      )
      .get()?.n ?? 0,
  )
}

export function findActiveFriend(db: Db, id: number): CrawlFriend | null {
  return (
    getOrm(db)
      .select({
        id: friends.id,
        author: friends.author,
        link: friends.link,
        feed: friends.feed,
        in_circle: friends.inCircle,
      })
      .from(friends)
      .where(and(eq(friends.id, id), eq(friends.status, 'active')))
      .get() ?? null
  )
}

export function findFriendBrief(db: Db, id: number) {
  return (
    getOrm(db)
      .select({ id: friends.id, author: friends.author, link: friends.link, feed: friends.feed })
      .from(friends)
      .where(eq(friends.id, id))
      .get() ?? null
  )
}

/** feed 只在仍为空时写回，避免覆盖人工配置 */
export function updateDiscoveredFeed(db: Db, friendId: number, feed: string): void {
  getOrm(db)
    .update(friends)
    .set({ feed, updatedAt: sql`datetime('now')` })
    .where(and(eq(friends.id, friendId), isNull(friends.feed)))
    .run()
}

export function markNotModified(db: Db, friendId: number, nextModifier: string, latencyMs: number | null): void {
  getOrm(db)
    .update(sourceState)
    .set({
      reachable: 1,
      crawlable: 1,
      bestMethod: 'rss',
      failCount: 0,
      unreachableSince: null,
      rssUnavailableSince: null,
      lastPostDaysAgo: sql`CASE WHEN last_post_published IS NULL THEN NULL ELSE MAX(0, CAST(julianday('now') - julianday(last_post_published) AS INTEGER)) END`,
      lastError: null,
      lastOkAt: sql`datetime('now')`,
      checkedAt: sql`datetime('now')`,
      nextCheckAt: sql`datetime('now', ${nextModifier})`,
      latencyMs,
    })
    .where(eq(sourceState.friendId, friendId))
    .run()
}

/** 跳过本轮（无 feed 且体检关闭等）也要推进 next_check_at，避免永久占用队首 */
export function markSkipped(db: Db, friendId: number, nextModifier: string): void {
  getOrm(db)
    .update(sourceState)
    .set({
      checkedAt: sql`datetime('now')`,
      nextCheckAt: sql`datetime('now', ${nextModifier})`,
    })
    .where(eq(sourceState.friendId, friendId))
    .run()
}

export interface RssSuccess {
  httpStatus: number
  latencyMs: number | null
  finalUrl: string | null
  etag: string | null
  lastModified: string | null
  lastPostPublished: string | null
  lastPostDaysAgo: number | null
  nextModifier: string
}

export function markRssSuccess(db: Db, friendId: number, r: RssSuccess): void {
  getOrm(db)
    .update(sourceState)
    .set({
      reachable: 1,
      crawlable: 1,
      bestMethod: 'rss',
      httpStatus: r.httpStatus,
      latencyMs: r.latencyMs,
      finalUrl: r.finalUrl,
      etag: r.etag,
      lastModified: r.lastModified,
      rssUnavailableSince: null,
      lastPostPublished: r.lastPostPublished === null ? sql`last_post_published` : r.lastPostPublished,
      lastPostDaysAgo: r.lastPostDaysAgo === null ? sql`last_post_days_ago` : r.lastPostDaysAgo,
      lastOkAt: sql`datetime('now')`,
      lastError: null,
      failCount: 0,
      unreachableSince: null,
      checkedAt: sql`datetime('now')`,
      nextCheckAt: sql`datetime('now', ${r.nextModifier})`,
    })
    .where(eq(sourceState.friendId, friendId))
    .run()
}

/** 体检关闭时的最简失败落账：按失联天数退避，下次继续尝试 */
export function markCrawlFailure(db: Db, friendId: number, error: string | null, nextModifier: string): void {
  getOrm(db)
    .update(sourceState)
    .set({
      reachable: 0,
      crawlable: 0,
      lastError: error,
      failCount: sql`${sourceState.failCount} + 1`,
      unreachableSince: sql`COALESCE(unreachable_since, datetime('now'))`,
      checkedAt: sql`datetime('now')`,
      nextCheckAt: sql`datetime('now', ${nextModifier})`,
    })
    .where(eq(sourceState.friendId, friendId))
    .run()
}

export function updateBacklink(db: Db, friendId: number, ok: boolean): void {
  getOrm(db)
    .update(sourceState)
    .set({ backlinkChecked: 1, backlink: ok ? 1 : 0 })
    .where(eq(sourceState.friendId, friendId))
    .run()
}

export interface HealthStateInput {
  reachable: boolean
  crawlable: boolean
  bestMethod: string
  httpStatus: number | null
  latencyMs: number | null
  finalUrl: string | null
  backlinkChecked: boolean
  backlink: boolean | null
  unreachableSince: string | null
  rssUnavailableSince: string | null
  lastPostPublished: string | null
  lastPostDaysAgo: number | null
  lastError: string | null
  failCount: number
  nextModifier: string
}

/** 体检结果 upsert；上次发文时间在本次无数据时保持原值 */
export function persistHealthState(db: Db, friendId: number, r: HealthStateInput): void {
  getOrm(db)
    .insert(sourceState)
    .values({
      friendId,
      reachable: r.reachable ? 1 : 0,
      crawlable: r.crawlable ? 1 : 0,
      bestMethod: r.bestMethod,
      httpStatus: r.httpStatus,
      latencyMs: r.latencyMs,
      finalUrl: r.finalUrl,
      backlinkChecked: r.backlinkChecked ? 1 : 0,
      backlink: r.backlink === null ? null : r.backlink ? 1 : 0,
      unreachableSince: r.unreachableSince,
      rssUnavailableSince: r.rssUnavailableSince,
      lastPostPublished: r.lastPostPublished,
      lastPostDaysAgo: r.lastPostDaysAgo,
      lastError: r.lastError,
      failCount: r.failCount,
      checkedAt: sql`datetime('now')`,
      nextCheckAt: sql`datetime('now', ${r.nextModifier})`,
    })
    .onConflictDoUpdate({
      target: sourceState.friendId,
      set: {
        reachable: sql`excluded.reachable`,
        crawlable: sql`excluded.crawlable`,
        bestMethod: sql`excluded.best_method`,
        httpStatus: sql`excluded.http_status`,
        latencyMs: sql`excluded.latency_ms`,
        finalUrl: sql`excluded.final_url`,
        backlinkChecked: sql`excluded.backlink_checked`,
        backlink: sql`excluded.backlink`,
        unreachableSince: sql`excluded.unreachable_since`,
        rssUnavailableSince: sql`excluded.rss_unavailable_since`,
        lastPostPublished: sql`COALESCE(excluded.last_post_published, last_post_published)`,
        lastPostDaysAgo: sql`COALESCE(excluded.last_post_days_ago, last_post_days_ago)`,
        lastError: sql`excluded.last_error`,
        failCount: sql`excluded.fail_count`,
        checkedAt: sql`excluded.checked_at`,
        nextCheckAt: sql`excluded.next_check_at`,
      },
    })
    .run()
}


export interface ArticleInput {
  guid: string
  title: string
  link: string
  author: string | null
  publishedAt: string
}

/** 文章增量 upsert + 每源保留上限；两步同一事务，避免并发读到半量 */
export function replaceFriendArticles(db: Db, friendId: number, entries: ArticleInput[], keep: number): void {
  getOrm(db).transaction((tx) => {
    if (entries.length > 0) {
      tx.insert(articles)
        .values(
          entries.map((e) => ({
            friendId,
            guid: e.guid,
            title: e.title,
            link: e.link,
            author: e.author,
            publishedAt: e.publishedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [articles.friendId, articles.guid],
          set: {
            title: sql`excluded.title`,
            link: sql`excluded.link`,
            author: sql`excluded.author`,
            publishedAt: sql`excluded.published_at`,
          },
        })
        .run()
    }

    const keepIds = tx
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.friendId, friendId))
      .orderBy(desc(sql`datetime(${articles.publishedAt})`), desc(articles.id))
      .limit(keep)
    tx.delete(articles)
      .where(and(eq(articles.friendId, friendId), notInArray(articles.id, keepIds)))
      .run()
  })
}

export function deleteArticle(db: Db, id: number): void {
  getOrm(db).delete(articles).where(eq(articles.id, id)).run()
}

export function deleteOldArticles(db: Db, cutoff: string): void {
  getOrm(db)
    .delete(articles)
    .where(sql`datetime(${articles.publishedAt}) < datetime(${cutoff})`)
    .run()
}

// ── 管理端列表 ────────────────────────────────────────────────────────────

export function listHealthSources(db: Db) {
  return getOrm(db)
    .select({ friend: friends, state: sourceState })
    .from(friends)
    .leftJoin(sourceState, eq(sourceState.friendId, friends.id))
    .orderBy(
      sql`CASE WHEN ${sourceState.reachable} = 0 THEN 0 ELSE 1 END`,
      asc(sourceState.nextCheckAt),
      asc(friends.id),
    )
    .all()
}

export function listAdminArticles(db: Db, friendId?: number) {
  const query = getOrm(db)
    .select({
      id: articles.id,
      friendId: articles.friendId,
      friendAuthor: friends.author,
      title: articles.title,
      link: articles.link,
      author: articles.author,
      publishedAt: articles.publishedAt,
      fetchedAt: articles.fetchedAt,
    })
    .from(articles)
    .innerJoin(friends, eq(friends.id, articles.friendId))
  return (friendId === undefined ? query : query.where(eq(articles.friendId, friendId)))
    .orderBy(desc(sql`datetime(${articles.publishedAt})`), desc(articles.id))
    .limit(200)
    .all()
}
