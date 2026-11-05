import type { Env } from '../types'
import { loadFlatSettings } from '../config/loader'
import { isoUtc } from '../util/time'
import { APP_VERSION } from '../version'
import { collectArticleRows, collectCoreRows, collectStateRows } from '../repositories/backup'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  countOf,
  type BackupApplication,
  type BackupArticle,
  type BackupData,
  type BackupEnvelope,
  type BackupFriend,
  type BackupSourceState,
} from './format'

/** 导出：把库内数据整理成自然键结构的备份信封 */

function str(v: string | null | undefined): string | undefined {
  return v === null || v === undefined || v === '' ? undefined : v
}

function boolOrNull(v: number | null | undefined): boolean | null | undefined {
  if (v === null || v === undefined) return v === null ? null : undefined
  return v === 1
}

export interface CollectOptions {
  includeArticles: boolean
}

export async function collectBackup(db: Env['DB'], env: Env, opts: CollectOptions): Promise<BackupEnvelope> {
  const { groups: groupsRows, friends: friendsRows, applications: appsRows } = collectCoreRows(db)
  const groupName = new Map(groupsRows.map((g) => [g.id, g.name]))

  const friends: BackupFriend[] = friendsRows.map((f) => {
    const item: BackupFriend = {
      group: groupName.get(f.groupId) ?? '未分组',
      author: f.author,
      link: f.link,
      since: f.since,
      inCircle: f.inCircle === 1,
      status: f.status === 'hidden' ? 'hidden' : 'active',
      sort: f.sort,
    }
    const nickname = str(f.nickname)
    const title = str(f.title)
    const desc = str(f.desc)
    const feed = str(f.feed)
    const icon = str(f.icon)
    const avatar = str(f.avatar)
    const archs = f.archs && f.archs.length > 0 ? f.archs : undefined
    const comment = str(f.comment)
    const createdAt = isoUtc(f.createdAt)
    if (nickname) item.nickname = nickname
    if (title) item.title = title
    if (desc) item.desc = desc
    if (feed) item.feed = feed
    if (icon) item.icon = icon
    if (avatar) item.avatar = avatar
    if (archs) item.archs = archs
    if (comment) item.comment = comment
    if (createdAt) item.createdAt = createdAt
    return item
  })

  const applications: BackupApplication[] = appsRows.map((a) => {
    const item: BackupApplication = {
      siteName: a.siteName,
      link: a.link,
      status: a.status === 'approved' || a.status === 'rejected' ? a.status : 'pending',
      createdAt: isoUtc(a.createdAt) ?? a.createdAt,
    }
    const author = str(a.author)
    const avatar = str(a.avatar)
    const feed = str(a.feed)
    const desc = str(a.desc)
    const contact = str(a.contact)
    const note = str(a.note)
    const backlinkDetail = str(a.backlinkDetail)
    const reviewNote = str(a.reviewNote)
    const backlinkCheckedAt = isoUtc(a.backlinkCheckedAt)
    const reviewedAt = isoUtc(a.reviewedAt)
    if (author) item.author = author
    if (avatar) item.avatar = avatar
    if (feed) item.feed = feed
    if (desc) item.desc = desc
    if (contact) item.contact = contact
    if (note) item.note = note
    if (backlinkDetail) item.backlinkDetail = backlinkDetail
    if (reviewNote) item.reviewNote = reviewNote
    if (a.backlinkOk !== null) item.backlinkOk = a.backlinkOk === 1
    if (backlinkCheckedAt) item.backlinkCheckedAt = backlinkCheckedAt
    if (reviewedAt) item.reviewedAt = reviewedAt
    return item
  })

  const settings = await loadFlatSettings(db, env)

  const groupItems: BackupData['groups'] = groupsRows.map((g) => {
    const item: BackupData['groups'][number] = { name: g.name, sort: g.sort }
    const desc = str(g.desc)
    if (desc) item.desc = desc
    return item
  })

  // 兜底：若库里有游离友链（分组缺失），补一个占位分组，保证备份一定能恢复
  const groupNames = new Set(groupItems.map((g) => g.name))
  for (const f of friends) {
    if (!groupNames.has(f.group)) {
      groupNames.add(f.group)
      groupItems.push({ name: f.group, sort: Number.MAX_SAFE_INTEGER })
    }
  }

  const data: BackupData = {
    groups: groupItems,
    friends,
    applications,
    settings: settings as Record<string, unknown>,
  }

  if (opts.includeArticles) {
    const articles: BackupArticle[] = collectArticleRows(db).map((a) => {
      const item: BackupArticle = {
        friend: a.friendLink,
        guid: a.guid,
        title: a.title,
        link: a.link,
        publishedAt: isoUtc(a.publishedAt) ?? a.publishedAt,
      }
      const author = str(a.author)
      const fetchedAt = isoUtc(a.fetchedAt)
      if (author) item.author = author
      if (fetchedAt) item.fetchedAt = fetchedAt
      return item
    })
    data.articles = articles

    const sourceState: BackupSourceState[] = collectStateRows(db).map((s) => {
      const item: BackupSourceState = { friend: s.friendLink }
      const etag = str(s.etag)
      const lastModified = str(s.lastModified)
      const bestMethod = str(s.bestMethod)
      const finalUrl = str(s.finalUrl)
      const unreachableSince = isoUtc(s.unreachableSince)
      const rssUnavailableSince = isoUtc(s.rssUnavailableSince)
      const lastPostPublished = isoUtc(s.lastPostPublished)
      const lastOkAt = isoUtc(s.lastOkAt)
      const lastError = str(s.lastError)
      const nextCheckAt = isoUtc(s.nextCheckAt)
      const checkedAt = isoUtc(s.checkedAt)
      if (etag) item.etag = etag
      if (lastModified) item.lastModified = lastModified
      if (bestMethod) item.bestMethod = bestMethod
      if (finalUrl) item.finalUrl = finalUrl
      if (lastError) item.lastError = lastError
      if (unreachableSince) item.unreachableSince = unreachableSince
      if (rssUnavailableSince) item.rssUnavailableSince = rssUnavailableSince
      if (lastPostPublished) item.lastPostPublished = lastPostPublished
      if (lastOkAt) item.lastOkAt = lastOkAt
      if (nextCheckAt) item.nextCheckAt = nextCheckAt
      if (checkedAt) item.checkedAt = checkedAt
      const reachable = boolOrNull(s.reachable)
      const crawlable = boolOrNull(s.crawlable)
      const backlinkChecked = boolOrNull(s.backlinkChecked)
      const backlink = boolOrNull(s.backlink)
      if (reachable !== undefined) item.reachable = reachable
      if (crawlable !== undefined) item.crawlable = crawlable
      if (backlinkChecked !== undefined) item.backlinkChecked = backlinkChecked
      if (backlink !== undefined) item.backlink = backlink
      if (s.httpStatus !== null) item.httpStatus = s.httpStatus
      if (s.latencyMs !== null) item.latencyMs = s.latencyMs
      if (s.lastPostDaysAgo !== null) item.lastPostDaysAgo = s.lastPostDaysAgo
      item.failCount = s.failCount
      return item
    })
    data.sourceState = sourceState
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    app: { version: APP_VERSION },
    counts: countOf(data),
    data,
  }
}
