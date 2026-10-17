import type { Env } from '../types'
import { loadFlatSettings } from '../config/loader'
import { isoUtc } from '../util/time'
import { APP_VERSION } from '../version'
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

interface GroupRow {
  id: number
  name: string
  desc: string | null
  sort: number
}

interface FriendRow {
  id: number
  group_id: number
  author: string
  nickname: string | null
  title: string | null
  desc: string | null
  link: string
  feed: string | null
  icon: string | null
  avatar: string | null
  archs: string | null
  since: string
  comment: string | null
  in_circle: number
  status: string
  sort: number
  created_at: string | null
}

interface ApplicationRow {
  site_name: string
  author: string | null
  link: string
  avatar: string | null
  feed: string | null
  desc: string | null
  contact: string | null
  note: string | null
  backlink_ok: number | null
  backlink_checked_at: string | null
  backlink_detail: string | null
  status: string
  review_note: string | null
  created_at: string
  reviewed_at: string | null
}

interface ArticleRow {
  friend_link: string
  guid: string
  title: string
  link: string
  author: string | null
  published_at: string
  fetched_at: string | null
}

interface StateRow {
  friend_link: string
  etag: string | null
  last_modified: string | null
  reachable: number | null
  crawlable: number | null
  best_method: string | null
  http_status: number | null
  latency_ms: number | null
  final_url: string | null
  backlink_checked: number | null
  backlink: number | null
  unreachable_since: string | null
  rss_unavailable_since: string | null
  last_post_published: string | null
  last_post_days_ago: number | null
  last_ok_at: string | null
  last_error: string | null
  fail_count: number
  next_check_at: string | null
  checked_at: string | null
}

function str(v: string | null | undefined): string | undefined {
  return v === null || v === undefined || v === '' ? undefined : v
}

function boolOrNull(v: number | null | undefined): boolean | null | undefined {
  if (v === null || v === undefined) return v === null ? null : undefined
  return v === 1
}

function parseArchs(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return undefined
    const out = arr.filter((x): x is string => typeof x === 'string')
    return out.length > 0 ? out : undefined
  } catch {
    return undefined
  }
}

export interface CollectOptions {
  includeArticles: boolean
}

export async function collectBackup(db: Env['DB'], env: Env, opts: CollectOptions): Promise<BackupEnvelope> {
  const groupsRows = await db
    .prepare('SELECT id, name, "desc", sort FROM groups ORDER BY sort, id')
    .all<GroupRow>()
  const friendsRows = await db
    .prepare(
      `SELECT id, group_id, author, nickname, title, "desc", link, feed, icon, avatar, archs,
              since, comment, in_circle, status, sort, created_at
         FROM friends ORDER BY sort, id`,
    )
    .all<FriendRow>()
  const appsRows = await db
    .prepare(
      `SELECT site_name, author, link, avatar, feed, "desc", contact, note, backlink_ok,
              backlink_checked_at, backlink_detail, status, review_note, created_at, reviewed_at
         FROM applications ORDER BY created_at, id`,
    )
    .all<ApplicationRow>()

  const groupName = new Map(groupsRows.results.map((g) => [g.id, g.name]))

  const friends: BackupFriend[] = friendsRows.results.map((f) => {
    const item: BackupFriend = {
      group: groupName.get(f.group_id) ?? '未分组',
      author: f.author,
      link: f.link,
      since: f.since,
      inCircle: f.in_circle === 1,
      status: f.status === 'hidden' ? 'hidden' : 'active',
      sort: f.sort,
    }
    const nickname = str(f.nickname)
    const title = str(f.title)
    const desc = str(f.desc)
    const feed = str(f.feed)
    const icon = str(f.icon)
    const avatar = str(f.avatar)
    const archs = parseArchs(f.archs)
    const comment = str(f.comment)
    const createdAt = isoUtc(f.created_at)
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

  const applications: BackupApplication[] = appsRows.results.map((a) => {
    const item: BackupApplication = {
      siteName: a.site_name,
      link: a.link,
      status: a.status === 'approved' || a.status === 'rejected' ? a.status : 'pending',
      createdAt: isoUtc(a.created_at) ?? a.created_at,
    }
    const author = str(a.author)
    const avatar = str(a.avatar)
    const feed = str(a.feed)
    const desc = str(a.desc)
    const contact = str(a.contact)
    const note = str(a.note)
    const backlinkDetail = str(a.backlink_detail)
    const reviewNote = str(a.review_note)
    const backlinkCheckedAt = isoUtc(a.backlink_checked_at)
    const reviewedAt = isoUtc(a.reviewed_at)
    if (author) item.author = author
    if (avatar) item.avatar = avatar
    if (feed) item.feed = feed
    if (desc) item.desc = desc
    if (contact) item.contact = contact
    if (note) item.note = note
    if (backlinkDetail) item.backlinkDetail = backlinkDetail
    if (reviewNote) item.reviewNote = reviewNote
    if (a.backlink_ok !== null) item.backlinkOk = a.backlink_ok === 1
    if (backlinkCheckedAt) item.backlinkCheckedAt = backlinkCheckedAt
    if (reviewedAt) item.reviewedAt = reviewedAt
    return item
  })

  const settings = await loadFlatSettings(db, env)

  const data: BackupData = {
    groups: groupsRows.results.map((g) => {
      const item: BackupData['groups'][number] = { name: g.name, sort: g.sort }
      const desc = str(g.desc)
      if (desc) item.desc = desc
      return item
    }),
    friends,
    applications,
    settings: settings as Record<string, unknown>,
  }

  if (opts.includeArticles) {
    const articlesRows = await db
      .prepare(
        `SELECT f.link AS friend_link, a.guid, a.title, a.link, a.author, a.published_at, a.fetched_at
           FROM articles a JOIN friends f ON f.id = a.friend_id
          ORDER BY a.id`,
      )
      .all<ArticleRow>()
    const articles: BackupArticle[] = articlesRows.results.map((a) => {
      const item: BackupArticle = {
        friend: a.friend_link,
        guid: a.guid,
        title: a.title,
        link: a.link,
        publishedAt: isoUtc(a.published_at) ?? a.published_at,
      }
      const author = str(a.author)
      const fetchedAt = isoUtc(a.fetched_at)
      if (author) item.author = author
      if (fetchedAt) item.fetchedAt = fetchedAt
      return item
    })
    data.articles = articles

    const statesRows = await db
      .prepare(
        `SELECT f.link AS friend_link, s.etag, s.last_modified, s.reachable, s.crawlable, s.best_method,
                s.http_status, s.latency_ms, s.final_url, s.backlink_checked, s.backlink,
                s.unreachable_since, s.rss_unavailable_since, s.last_post_published, s.last_post_days_ago,
                s.last_ok_at, s.last_error, s.fail_count, s.next_check_at, s.checked_at
           FROM source_state s JOIN friends f ON f.id = s.friend_id
          ORDER BY f.id`,
      )
      .all<StateRow>()
    const sourceState: BackupSourceState[] = statesRows.results.map((s) => {
      const item: BackupSourceState = { friend: s.friend_link }
      const etag = str(s.etag)
      const lastModified = str(s.last_modified)
      const bestMethod = str(s.best_method)
      const finalUrl = str(s.final_url)
      const unreachableSince = isoUtc(s.unreachable_since)
      const rssUnavailableSince = isoUtc(s.rss_unavailable_since)
      const lastPostPublished = isoUtc(s.last_post_published)
      const lastOkAt = isoUtc(s.last_ok_at)
      const lastError = str(s.last_error)
      const nextCheckAt = isoUtc(s.next_check_at)
      const checkedAt = isoUtc(s.checked_at)
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
      const backlinkChecked = boolOrNull(s.backlink_checked)
      const backlink = boolOrNull(s.backlink)
      if (reachable !== undefined) item.reachable = reachable
      if (crawlable !== undefined) item.crawlable = crawlable
      if (backlinkChecked !== undefined) item.backlinkChecked = backlinkChecked
      if (backlink !== undefined) item.backlink = backlink
      if (s.http_status !== null) item.httpStatus = s.http_status
      if (s.latency_ms !== null) item.latencyMs = s.latency_ms
      if (s.last_post_days_ago !== null) item.lastPostDaysAgo = s.last_post_days_ago
      item.failCount = s.fail_count
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
