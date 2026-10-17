import { z } from 'zod'
import { httpUrl, dateYMD } from '../util/validate'

/**
 * 备份信封（DESIGN 备份章节）
 *
 * 用自然键而不是自增 id：友链以 link、分组以 name、文章/体检状态以所属友链的 link
 * 关联。跨实例恢复不需要重映射 id，也不依赖 sqlite_sequence。
 * 版本升级时新增字段保持向后兼容；不兼容的改动提升 version。
 */

export const BACKUP_FORMAT = 'youlin.backup'
export const BACKUP_VERSION = 1

const backupGroup = z.object({
  name: z.string().min(1).max(100),
  desc: z.string().max(2000).optional(),
  sort: z.number().int().min(0),
})

const backupFriend = z.object({
  group: z.string().min(1).max(100),
  author: z.string().min(1).max(200),
  nickname: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  desc: z.string().max(2000).optional(),
  link: httpUrl,
  feed: httpUrl.optional(),
  icon: httpUrl.optional(),
  avatar: httpUrl.optional(),
  archs: z.array(z.string().max(100)).max(20).optional(),
  since: dateYMD,
  comment: z.string().max(2000).optional(),
  inCircle: z.boolean(),
  status: z.enum(['active', 'hidden']),
  sort: z.number().int().min(0),
  createdAt: z.string().max(40).optional(),
})

const backupApplication = z.object({
  siteName: z.string().min(1).max(200),
  author: z.string().max(200).optional(),
  link: httpUrl,
  avatar: httpUrl.optional(),
  feed: httpUrl.optional(),
  desc: z.string().max(2000).optional(),
  contact: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
  backlinkOk: z.boolean().nullable().optional(),
  backlinkCheckedAt: z.string().max(40).optional(),
  backlinkDetail: z.string().max(2000).optional(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewNote: z.string().max(2000).optional(),
  createdAt: z.string().max(40),
  reviewedAt: z.string().max(40).optional(),
})

const backupArticle = z.object({
  friend: httpUrl,
  guid: z.string().min(1).max(2000),
  title: z.string().max(500),
  link: httpUrl,
  author: z.string().max(200).optional(),
  publishedAt: z.string().max(40),
  fetchedAt: z.string().max(40).optional(),
})

const backupSourceState = z.object({
  friend: httpUrl,
  etag: z.string().max(500).optional(),
  lastModified: z.string().max(100).optional(),
  reachable: z.boolean().nullable().optional(),
  crawlable: z.boolean().nullable().optional(),
  bestMethod: z.string().max(20).optional(),
  httpStatus: z.number().int().optional(),
  latencyMs: z.number().int().optional(),
  finalUrl: z.string().max(2048).optional(),
  backlinkChecked: z.boolean().nullable().optional(),
  backlink: z.boolean().nullable().optional(),
  unreachableSince: z.string().max(40).optional(),
  rssUnavailableSince: z.string().max(40).optional(),
  lastPostPublished: z.string().max(40).optional(),
  lastPostDaysAgo: z.number().int().optional(),
  lastOkAt: z.string().max(40).optional(),
  lastError: z.string().max(2000).optional(),
  failCount: z.number().int().min(0).optional(),
  nextCheckAt: z.string().max(40).optional(),
  checkedAt: z.string().max(40).optional(),
})

export const backupData = z.object({
  groups: z.array(backupGroup).max(5000),
  friends: z.array(backupFriend).max(20000),
  applications: z.array(backupApplication).max(20000),
  /** 扁平 camelCase 配置键；不含 internal.* 运行时簿记 */
  settings: z.record(z.string(), z.unknown()),
  articles: z.array(backupArticle).max(200000).optional(),
  sourceState: z.array(backupSourceState).max(20000).optional(),
})

export const backupEnvelope = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string().max(40),
  app: z.object({ version: z.string().max(40).optional() }).optional(),
  counts: z
    .object({
      groups: z.number().int(),
      friends: z.number().int(),
      applications: z.number().int(),
      articles: z.number().int().optional(),
    })
    .optional(),
  data: backupData,
})

export type BackupGroup = z.infer<typeof backupGroup>
export type BackupFriend = z.infer<typeof backupFriend>
export type BackupApplication = z.infer<typeof backupApplication>
export type BackupArticle = z.infer<typeof backupArticle>
export type BackupSourceState = z.infer<typeof backupSourceState>
export type BackupData = z.infer<typeof backupData>
export type BackupEnvelope = z.infer<typeof backupEnvelope>

/** 备份文件命名：youlin-backup-20261017-140500.json.gz（UTC） */
export function backupFileName(at = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp =
    `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-` +
    `${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}`
  return `youlin-backup-${stamp}.json.gz`
}

export function countOf(data: BackupData): NonNullable<BackupEnvelope['counts']> {
  return {
    groups: data.groups.length,
    friends: data.friends.length,
    applications: data.applications.length,
    articles: data.articles?.length ?? 0,
  }
}
