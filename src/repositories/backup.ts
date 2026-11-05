import { asc, eq, inArray, sql } from 'drizzle-orm'
import { getOrm } from '../server/orm'
import { applications, articles, friends, groups, settings, sourceState } from '../server/schema'
import { dbTime, isoUtc } from '../util/time'
import type { BackupData } from '../backup/format'
import type { Db } from '../types'

/** 备份导出用的原始行；自然键映射在 backup/collect.ts 完成 */
export function collectCoreRows(db: Db) {
  const orm = getOrm(db)
  return {
    groups: orm.select().from(groups).orderBy(asc(groups.sort), asc(groups.id)).all(),
    friends: orm.select().from(friends).orderBy(asc(friends.sort), asc(friends.id)).all(),
    applications: orm.select().from(applications).orderBy(asc(applications.createdAt), asc(applications.id)).all(),
  }
}

export function collectArticleRows(db: Db) {
  return getOrm(db)
    .select({
      friendLink: friends.link,
      guid: articles.guid,
      title: articles.title,
      link: articles.link,
      author: articles.author,
      publishedAt: articles.publishedAt,
      fetchedAt: articles.fetchedAt,
    })
    .from(articles)
    .innerJoin(friends, eq(friends.id, articles.friendId))
    .orderBy(asc(articles.id))
    .all()
}

export function collectStateRows(db: Db) {
  return getOrm(db)
    .select({
      friendLink: friends.link,
      etag: sourceState.etag,
      lastModified: sourceState.lastModified,
      reachable: sourceState.reachable,
      crawlable: sourceState.crawlable,
      bestMethod: sourceState.bestMethod,
      httpStatus: sourceState.httpStatus,
      latencyMs: sourceState.latencyMs,
      finalUrl: sourceState.finalUrl,
      backlinkChecked: sourceState.backlinkChecked,
      backlink: sourceState.backlink,
      unreachableSince: sourceState.unreachableSince,
      rssUnavailableSince: sourceState.rssUnavailableSince,
      lastPostPublished: sourceState.lastPostPublished,
      lastPostDaysAgo: sourceState.lastPostDaysAgo,
      lastOkAt: sourceState.lastOkAt,
      lastError: sourceState.lastError,
      failCount: sourceState.failCount,
      nextCheckAt: sourceState.nextCheckAt,
      checkedAt: sourceState.checkedAt,
    })
    .from(sourceState)
    .innerJoin(friends, eq(friends.id, sourceState.friendId))
    .orderBy(asc(sourceState.friendId))
    .all()
}

export interface RestoreCounts {
  articles: number
  sourceState: number
  settings: number
}

const CHUNK = 100

function boolInt(v: boolean | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return v ? 1 : 0
}

/**
 * 覆盖式恢复：清空 + 写入放在同一事务。
 * 任一条写入失败都会整体回滚，不会留下“清空了旧数据但只恢复了一半”的状态。
 */
export function replaceAllData(
  db: Db,
  data: BackupData,
  settingsRows: { key: string; value: string }[],
  configKeys: string[],
): RestoreCounts {
  const orm = getOrm(db)
  return orm.transaction((tx) => {
    tx.delete(articles).run()
    tx.delete(sourceState).run()
    tx.delete(applications).run()
    tx.delete(friends).run()
    tx.delete(groups).run()
    for (let i = 0; i < configKeys.length; i += CHUNK) {
      tx.delete(settings).where(inArray(settings.key, configKeys.slice(i, i + CHUNK))).run()
    }

    const groupIdByName = new Map<string, number>()
    const orderedGroups = [...data.groups].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    for (let i = 0; i < orderedGroups.length; i += CHUNK) {
      const rows = tx
        .insert(groups)
        .values(
          orderedGroups.slice(i, i + CHUNK).map((g) => ({
            name: g.name,
            desc: g.desc ?? null,
            sort: g.sort,
          })),
        )
        .returning({ id: groups.id, name: groups.name })
        .all()
      for (const row of rows) groupIdByName.set(row.name, row.id)
    }

    const friendIdByLink = new Map<string, number>()
    const orderedFriends = [...data.friends].sort((a, b) => a.sort - b.sort || a.link.localeCompare(b.link))
    for (let i = 0; i < orderedFriends.length; i += CHUNK) {
      const rows = tx
        .insert(friends)
        .values(
          orderedFriends.slice(i, i + CHUNK).map((f) => ({
            groupId: groupIdByName.get(f.group)!,
            author: f.author,
            nickname: f.nickname ?? null,
            title: f.title ?? null,
            desc: f.desc ?? null,
            link: f.link,
            feed: f.feed ?? null,
            icon: f.icon ?? null,
            avatar: f.avatar ?? null,
            archs: f.archs && f.archs.length > 0 ? f.archs : null,
            since: f.since,
            comment: f.comment ?? null,
            inCircle: f.inCircle ? 1 : 0,
            status: f.status,
            sort: f.sort,
            createdAt: f.createdAt ? dbTime(f.createdAt) : sql`datetime('now')`,
          })),
        )
        .returning({ id: friends.id, link: friends.link })
        .all()
      for (const row of rows) friendIdByLink.set(row.link, row.id)
    }

    const seenArticles = new Set<string>()
    const articleRows = (data.articles ?? [])
      .filter((a) => {
        const key = `${a.friend}\u0000${a.guid}`
        if (seenArticles.has(key)) return false
        seenArticles.add(key)
        return true
      })
      .map((a) => ({
        friendId: friendIdByLink.get(a.friend)!,
        guid: a.guid,
        title: a.title,
        link: a.link,
        author: a.author ?? null,
        // 抓取路径存 ISO 8601；恢复也必须保持同一格式，避免字符串排序/清理边界错乱
        publishedAt: isoUtc(a.publishedAt) ?? a.publishedAt,
        fetchedAt: a.fetchedAt ? dbTime(a.fetchedAt) : sql`datetime('now')`,
      }))
    for (let i = 0; i < articleRows.length; i += CHUNK) {
      tx.insert(articles).values(articleRows.slice(i, i + CHUNK)).run()
    }

    const seenStates = new Set<string>()
    const stateRows = (data.sourceState ?? [])
      .filter((s) => {
        if (seenStates.has(s.friend)) return false
        seenStates.add(s.friend)
        return true
      })
      .map((s) => ({
        friendId: friendIdByLink.get(s.friend)!,
        etag: s.etag ?? null,
        lastModified: s.lastModified ?? null,
        reachable: boolInt(s.reachable),
        crawlable: boolInt(s.crawlable),
        bestMethod: s.bestMethod ?? null,
        httpStatus: s.httpStatus ?? null,
        latencyMs: s.latencyMs ?? null,
        finalUrl: s.finalUrl ?? null,
        backlinkChecked: boolInt(s.backlinkChecked),
        backlink: boolInt(s.backlink),
        unreachableSince: s.unreachableSince ? dbTime(s.unreachableSince) : null,
        rssUnavailableSince: s.rssUnavailableSince ? dbTime(s.rssUnavailableSince) : null,
        lastPostPublished: s.lastPostPublished ? dbTime(s.lastPostPublished) : null,
        lastPostDaysAgo: s.lastPostDaysAgo ?? null,
        lastOkAt: s.lastOkAt ? dbTime(s.lastOkAt) : null,
        lastError: s.lastError ?? null,
        failCount: s.failCount ?? 0,
        nextCheckAt: s.nextCheckAt ? dbTime(s.nextCheckAt) : null,
        checkedAt: s.checkedAt ? dbTime(s.checkedAt) : null,
      }))
    for (let i = 0; i < stateRows.length; i += CHUNK) {
      tx.insert(sourceState).values(stateRows.slice(i, i + CHUNK)).run()
    }

    // 旧备份可能含重复 pending；保留第一条，其余按已拒绝恢复，避免新唯一索引导致整包失败
    const pendingLinks = new Set<string>()
    const applicationRows = data.applications.map((a) => {
      let status = a.status
      let reviewNote = a.reviewNote ?? null
      if (status === 'pending') {
        if (pendingLinks.has(a.link)) {
          status = 'rejected'
          reviewNote = `${reviewNote ? `${reviewNote}；` : ''}重复待审链接（恢复时自动合并）`
        } else {
          pendingLinks.add(a.link)
        }
      }
      return {
        siteName: a.siteName,
        author: a.author ?? null,
        link: a.link,
        avatar: a.avatar ?? null,
        feed: a.feed ?? null,
        desc: a.desc ?? null,
        contact: a.contact ?? null,
        note: a.note ?? null,
        backlinkOk: boolInt(a.backlinkOk),
        backlinkCheckedAt: a.backlinkCheckedAt ? dbTime(a.backlinkCheckedAt) : null,
        backlinkDetail: a.backlinkDetail ?? null,
        status,
        reviewNote,
        createdAt: a.createdAt ? dbTime(a.createdAt) : sql`datetime('now')`,
        reviewedAt: a.reviewedAt ? dbTime(a.reviewedAt) : null,
      }
    })
    for (let i = 0; i < applicationRows.length; i += CHUNK) {
      tx.insert(applications).values(applicationRows.slice(i, i + CHUNK)).run()
    }

    for (let i = 0; i < settingsRows.length; i += CHUNK) {
      tx.insert(settings)
        .values(settingsRows.slice(i, i + CHUNK))
        .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } })
        .run()
    }

    return {
      articles: articleRows.length,
      sourceState: stateRows.length,
      settings: settingsRows.length,
    }
  })
}
