import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { applications, applyRateLimit, friends } from '../server/schema'
import type { Db } from '../types'

export type ApplicationInsert = typeof applications.$inferInsert
export type FriendInsert = typeof friends.$inferInsert

export function listApplications(
  db: Db,
  status: 'pending' | 'approved' | 'rejected' | 'all',
): (typeof applications.$inferSelect)[] {
  const orm = getOrm(db)
  const base = orm.select().from(applications)
  const rows =
    status === 'all'
      ? base.orderBy(desc(applications.createdAt), desc(applications.id)).limit(200).all()
      : base
          .where(eq(applications.status, status))
          .orderBy(desc(applications.createdAt), desc(applications.id))
          .limit(200)
          .all()
  return rows
}

export function findApplicationById(db: Db, id: number) {
  return getOrm(db).select().from(applications).where(eq(applications.id, id)).get() ?? null
}

export function insertApplication(db: Db, input: ApplicationInsert): number {
  return getOrm(db)
    .insert(applications)
    .values(input)
    .returning({ id: applications.id })
    .get().id
}

export function findFriendIdByLinks(db: Db, links: string[]): number | null {
  if (links.length === 0) return null
  const row = getOrm(db).select({ id: friends.id }).from(friends).where(inArray(friends.link, links)).limit(1).get()
  return row?.id ?? null
}

export function findPendingApplicationIdByLinks(db: Db, links: string[]): number | null {
  if (links.length === 0) return null
  const row = getOrm(db)
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.status, 'pending'), inArray(applications.link, links)))
    .limit(1)
    .get()
  return row?.id ?? null
}

/** autoApprove：建友链 + 写申请在同一事务内完成 */
export function createAutoApprovedApplication(
  db: Db,
  groupId: number,
  friend: Omit<FriendInsert, 'groupId'>,
  app: ApplicationInsert,
  now: string,
): { friendId: number; applicationId: number } {
  return getOrm(db).transaction((tx) => {
    const friendId = tx
      .insert(friends)
      .values({ ...friend, groupId })
      .returning({ id: friends.id })
      .get().id
    const applicationId = tx
      .insert(applications)
      .values({
        ...app,
        status: 'approved',
        reviewNote: `autoApprove（友链 #${friendId}）`,
        reviewedAt: now,
      })
      .returning({ id: applications.id })
      .get().id
    return { friendId, applicationId }
  })
}

/** 审核通过：建友链 + 状态翻转在同一事务内完成 */
export function approveApplication(
  db: Db,
  applicationId: number,
  groupId: number,
  friend: Omit<FriendInsert, 'groupId'>,
  now: string,
): number {
  return getOrm(db).transaction((tx) => {
    const friendId = tx
      .insert(friends)
      .values({ ...friend, groupId })
      .returning({ id: friends.id })
      .get().id
    tx.update(applications)
      .set({
        status: 'approved',
        reviewNote: `通过（友链 #${friendId}）`,
        reviewedAt: now,
      })
      .where(eq(applications.id, applicationId))
      .run()
    return friendId
  })
}

export function rejectApplication(db: Db, id: number, reason: string | null, now: string): void {
  getOrm(db)
    .update(applications)
    .set({ status: 'rejected', reviewNote: reason, reviewedAt: now })
    .where(eq(applications.id, id))
    .run()
}

/** 原子预占一次申请名额；超限返回 false */
export function reserveApplyAttempt(db: Db, ip: string, day: string, limit: number): boolean {
  return getOrm(db).transaction((tx) => {
    tx.delete(applyRateLimit).where(lt(applyRateLimit.day, day)).run()
    const used = Number(
      tx.select({ count: applyRateLimit.count })
        .from(applyRateLimit)
        .where(and(eq(applyRateLimit.ip, ip), eq(applyRateLimit.day, day)))
        .get()?.count ?? 0,
    )
    if (used >= limit) return false
    tx.insert(applyRateLimit)
      .values({ ip, day, count: 1 })
      .onConflictDoUpdate({
        target: [applyRateLimit.ip, applyRateLimit.day],
        set: { count: sql`${applyRateLimit.count} + 1` },
      })
      .run()
    return true
  })
}

/** 提交失败时归还预占名额，保持“成功才计数”的语义 */
export function releaseApplyAttempt(db: Db, ip: string, day: string): void {
  getOrm(db).transaction((tx) => {
    tx.update(applyRateLimit)
      .set({ count: sql`${applyRateLimit.count} - 1` })
      .where(and(eq(applyRateLimit.ip, ip), eq(applyRateLimit.day, day)))
      .run()
    tx.delete(applyRateLimit).where(and(eq(applyRateLimit.ip, ip), eq(applyRateLimit.day, day), lt(applyRateLimit.count, 1))).run()
  })
}

/** 清理已处理申请，控制长期数据量 */
export function deleteReviewedApplications(db: Db): number {
  return getOrm(db)
    .delete(applications)
    .where(inArray(applications.status, ['approved', 'rejected']))
    .returning({ id: applications.id })
    .all().length
}
