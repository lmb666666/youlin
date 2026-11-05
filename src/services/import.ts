import { AppError } from '../errors'
import { dateOnly } from '../util/time'
import { httpUrl } from '../util/validate'
import { importFriends, type ImportFriendInput } from '../repositories/import'
import type { Db } from '../types'
import type { ImportResult } from '@youlin/contracts'

/**
 * 数据导入（DESIGN §5 POST /api/admin/import）
 * 接受"任意来源 JSON"：常见字段别名做映射，按 link 去重 upsert（缺省字段保留旧值）。
 */

interface ImportError {
  index: number
  message: string
}

/** 字段别名表（从左到右取第一个非空值） */
const ALIASES = {
  link: ['link', 'url', 'site', 'siteUrl', 'siteLink', 'homepage', 'home'],
  author: ['author', 'name', 'owner', 'blogger'],
  nickname: ['nickname', 'nickName'],
  title: ['title', 'siteName', 'blogName'],
  desc: ['desc', 'description', 'slogan', 'intro', 'bio'],
  feed: ['feed', 'rss', 'rssUrl', 'feedUrl', 'atom', 'subscribeUrl'],
  icon: ['icon', 'favicon', 'iconUrl', 'faviconUrl'],
  avatar: ['avatar', 'img', 'image', 'photo', 'headUrl', 'headPic'],
  archs: ['archs', 'arch', 'framework', 'frameworks', 'tech'],
  comment: ['comment', 'note', 'remark'],
  group: ['group', 'groupName', 'category'],
  since: ['since', 'sinceDate', 'joinDate', 'startDate', 'date'],
} as const

function pickString(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = item[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

/** 可选 URL 字段：缺省返回 null；给了但不合法则记录错误并丢弃该字段 */
function pickHttpUrl(
  item: Record<string, unknown>,
  keys: readonly string[],
  index: number,
  field: string,
  errors: ImportError[],
): string | null {
  const value = pickString(item, keys)
  if (!value) return null
  if (!httpUrl.safeParse(value).success) {
    errors.push({ index, message: `${field} 不是合法的 http(s) 链接` })
    return null
  }
  return value
}

function pickArchs(item: Record<string, unknown>): string[] | null {
  for (const k of ALIASES.archs) {
    const v = item[k]
    if (Array.isArray(v)) {
      const arr = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((s) => s.trim())
      if (arr.length > 0) return arr
    } else if (typeof v === 'string' && v.trim() !== '') {
      const arr = v.split(/[,，、|/]/).map((s) => s.trim()).filter(Boolean)
      if (arr.length > 0) return arr
    }
  }
  return null
}

function hostOf(link: string): string {
  try {
    return new URL(link).hostname
  } catch {
    return link
  }
}

/** 常见的"假"写法（"false"/"0"/0/false/null/""）都视为关闭，避免 Boolean("false")===true 陷阱 */
const FALSY = new Set<unknown>([false, 0, '0', 'false', 'False', 'FALSE', null, ''])

function normalizeItem(raw: unknown, fallbackGroup: string | null, index: number, errors: ImportError[]): ImportFriendInput | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ index, message: '条目须为 JSON 对象' })
    return null
  }
  const item = raw as Record<string, unknown>
  const link = pickString(item, ALIASES.link)
  if (!link || !httpUrl.safeParse(link).success) {
    errors.push({ index, message: '缺少合法的站点链接（link/url/site…）' })
    return null
  }

  const explicitAuthor = pickString(item, ALIASES.author)
  const nickname = pickString(item, ALIASES.nickname)
  const title = pickString(item, ALIASES.title)
  const desc = pickString(item, ALIASES.desc)
  const comment = pickString(item, ALIASES.comment)
  const group = pickString(item, ALIASES.group) ?? fallbackGroup ?? undefined
  const author = explicitAuthor ?? nickname ?? title ?? hostOf(link)
  const archs = pickArchs(item)

  // 与备份 schema 保持一致，避免导入出无法备份/恢复的行
  const tooLong = (value: string | null | undefined, max: number) => typeof value === 'string' && value.length > max
  if (tooLong(group, 100)) {
    errors.push({ index, message: '分组名称不能超过 100 字' })
    return null
  }
  if (tooLong(author, 200) || tooLong(nickname, 200) || tooLong(title, 200)) {
    errors.push({ index, message: '作者/趣称/标题不能超过 200 字' })
    return null
  }
  if (tooLong(desc, 2000) || tooLong(comment, 2000) || tooLong(hostOf(link), 200)) {
    errors.push({ index, message: '简介/备注超出长度上限' })
    return null
  }
  if (archs && (archs.length > 20 || archs.some((a) => a.length > 100))) {
    errors.push({ index, message: '架构最多 20 项，每项不超过 100 字' })
    return null
  }

  // 只有显式出现 inCircle 才更新：缺省时保留旧值，新条目默认纳入
  const hasInCircle = Object.prototype.hasOwnProperty.call(item, 'inCircle')
  const inCircle = hasInCircle ? !FALSY.has(item.inCircle) : undefined
  const status = item.status === 'active' || item.status === 'hidden' ? item.status : undefined
  const sinceRaw = pickString(item, ALIASES.since)
  const since = sinceRaw ? dateOnly(sinceRaw) : undefined
  if (sinceRaw && !since) errors.push({ index, message: 'since 不是合法日期（YYYY-MM-DD）' })

  return {
    group,
    author,
    authorProvided: explicitAuthor !== null,
    nickname,
    title,
    desc,
    link,
    feed: pickHttpUrl(item, ALIASES.feed, index, 'feed', errors),
    icon: pickHttpUrl(item, ALIASES.icon, index, 'icon', errors),
    avatar: pickHttpUrl(item, ALIASES.avatar, index, 'avatar', errors),
    archs,
    since: since ?? dateOnly(new Date())!,
    comment,
    inCircle,
    status,
  }
}

/** 把任意形状的导入 JSON 归一为条目流 */
function collectItems(body: unknown): { raw: unknown[]; groupOf: (i: number) => string | null } {
  if (Array.isArray(body)) return { raw: body, groupOf: () => null }
  if (body !== null && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    if (Array.isArray(obj.groups)) {
      const raw: unknown[] = []
      const groups: (string | null)[] = []
      for (const g of obj.groups) {
        const rec = g !== null && typeof g === 'object' ? (g as Record<string, unknown>) : {}
        const name = typeof rec.name === 'string' && rec.name.trim() !== '' ? rec.name.trim() : null
        const items = (rec.links ?? rec.friends ?? rec.sites ?? rec.items ?? []) as unknown[]
        for (const it of items) {
          raw.push(it)
          groups.push(name)
        }
      }
      return { raw, groupOf: (i) => groups[i] ?? null }
    }
    const flat = obj.friends ?? obj.links ?? obj.sites ?? obj.items
    if (Array.isArray(flat)) return { raw: flat, groupOf: () => null }
  }
  return { raw: [], groupOf: () => null }
}

export function importData(db: Db, body: unknown): ImportResult {
  const { raw, groupOf } = collectItems(body)
  if (raw.length === 0) throw new AppError(400, 'empty_input', '未识别到可导入条目')

  const errors: ImportError[] = []
  const items: ImportFriendInput[] = []
  raw.forEach((r, i) => {
    const n = normalizeItem(r, groupOf(i), i, errors)
    if (n) items.push(n)
  })

  const result = importFriends(db, items)

  return {
    imported: result.imported,
    updated: result.updated,
    skipped: errors.length,
    groupsCreated: result.groupsCreated,
    errors: errors.slice(0, 20),
  }
}
