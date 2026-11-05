import { isoUtc, daysSince } from '../util/time'
import { listPublicGroups } from '../repositories/links'
import { circleStats, listCircleArticles } from '../repositories/articles'
import type { FriendRow, SourceStateRow } from '../server/schema'
import type { AppConfig, Db } from '../types'

/**
 * 公开接口数据（DESIGN §4.1/§4.2）：
 *   /api/links  分组 + 友链 + 体检摘要
 *   /api/circle stats + 文章（统计口径基于参与朋友圈的全集，不随 limit 变化）
 */

export interface LinkOutput {
  author: string
  title?: string
  desc?: string
  link: string
  feed?: string
  icon?: string
  avatar?: string
  archs?: string[]
  since: string
  comment?: string
  health?: {
    reachable?: boolean
    crawlable?: boolean
    /** true/false；null=未检测 */
    backlink: boolean | null
    /** 秒；不可达为 -1 */
    latency?: number
    lastPostAt?: string
    staleDays?: number
    /** 失联天数；正常 null */
    unreachableDays?: number | null
    checkedAt: string
  }
}

export function buildLink(f: FriendRow, s: SourceStateRow | null): LinkOutput {
  const out: LinkOutput = { author: f.author, link: f.link, since: f.since }
  if (f.title) out.title = f.title
  if (f.desc) out.desc = f.desc
  if (f.feed) out.feed = f.feed
  if (f.icon) out.icon = f.icon
  if (f.avatar) out.avatar = f.avatar
  if (f.archs && f.archs.length > 0) out.archs = f.archs
  if (f.comment) out.comment = f.comment

  if (s?.checkedAt) {
    const health: Omit<NonNullable<LinkOutput['health']>, 'checkedAt'> = {
      // checked=1 但值为 NULL（页面不可达/非 2xx）= 未检测到，不是“确定无反链”
      backlink: s.backlinkChecked ? (s.backlink === null ? null : s.backlink === 1) : null,
    }
    if (s.reachable !== null) health.reachable = s.reachable === 1
    if (s.crawlable !== null) health.crawlable = s.crawlable === 1
    if (s.reachable === 0) {
      health.latency = -1
    } else if (s.latencyMs !== null) {
      health.latency = Math.round((s.latencyMs / 1000) * 100) / 100
    }
    const lastPostAt = isoUtc(s.lastPostPublished)
    if (lastPostAt) health.lastPostAt = lastPostAt
    if (s.lastPostDaysAgo !== null) health.staleDays = s.lastPostDaysAgo
    health.unreachableDays = s.reachable === 0 && s.unreachableSince ? (daysSince(s.unreachableSince) ?? null) : null
    const checkedAt = isoUtc(s.checkedAt)
    if (checkedAt) out.health = { ...health, checkedAt }
  }
  return out
}

export function publicLinks(db: Db, cfg: AppConfig, group?: string) {
  return {
    groups: listPublicGroups(db, cfg.api.includeHidden, group).map((g) => {
      const out: { name: string; desc?: string; links: LinkOutput[] } = { name: g.name, links: [] }
      if (g.desc) out.desc = g.desc
      for (const entry of g.links) out.links.push(buildLink(entry.friend, entry.state))
      return out
    }),
  }
}

export function publicCircle(db: Db, cfg: AppConfig, limitQuery?: string) {
  const stats = circleStats(db)

  const requested = Number(limitQuery)
  const cap = Math.min(cfg.crawl.outputMaxArticles, cfg.api.maxLimit)
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, cap) : cap
  const articles = listCircleArticles(db, limit)

  return {
    stats: {
      friends: stats.friends,
      active: stats.active,
      failed: stats.failed,
      articles: stats.articles,
      updatedAt: isoUtc(stats.updatedAt) ?? null,
    },
    articles: articles.map((a) => {
      const out: { title: string; link: string; author?: string; avatar?: string; publishedAt: string } = {
        title: a.title,
        link: a.link,
        publishedAt: isoUtc(a.publishedAt) ?? a.publishedAt,
      }
      if (a.author) out.author = a.author
      if (a.avatar) out.avatar = a.avatar
      return out
    }),
  }
}
