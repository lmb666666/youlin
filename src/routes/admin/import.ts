import { Hono } from 'hono'
import { jsonError, readJson } from '../../util/http'
import { dateOnly } from '../../util/time'
import { httpUrl } from '../../util/validate'
import type { AppEnv } from '../../types'

/**
 * 数据导入（DESIGN §5 POST /api/admin/import）
 * 接受"任意来源 JSON"：常见字段别名做映射，按 link 去重 upsert（缺省字段保留旧值）。
 */

interface ImportError {
  index: number
  message: string
}

interface Normalized {
  /** undefined = 条目没有提供分组；新条目落到「未分组」，冲突更新时保留旧分组 */
  group: string | undefined
  author: string
  /** 是否显式提供了作者；仅显式提供时才在冲突更新中覆盖旧值 */
  authorProvided: boolean
  nickname: string | null
  title: string | null
  desc: string | null
  link: string
  feed: string | null
  icon: string | null
  avatar: string | null
  archs: string[] | null
  since: string
  comment: string | null
  /** undefined = 条目没有提供；保持旧值，新条目默认纳入朋友圈 */
  inCircle: boolean | undefined
  /** undefined = 条目没有提供；保持旧值，新条目默认 active */
  status: 'active' | 'hidden' | undefined
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

function normalizeItem(raw: unknown, fallbackGroup: string | null, index: number, errors: ImportError[]): Normalized | null {
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
  const author = explicitAuthor ?? nickname ?? pickString(item, ALIASES.title) ?? hostOf(link)

  // 只有显式出现 inCircle 才更新：缺省时保留旧值，新条目默认纳入
  const hasInCircle = Object.prototype.hasOwnProperty.call(item, 'inCircle')
  const inCircle = hasInCircle ? !FALSY.has(item.inCircle) : undefined
  const status = item.status === 'active' || item.status === 'hidden' ? item.status : undefined

  return {
    group: pickString(item, ALIASES.group) ?? fallbackGroup ?? undefined,
    author,
    authorProvided: explicitAuthor !== null,
    nickname,
    title: pickString(item, ALIASES.title),
    desc: pickString(item, ALIASES.desc),
    link,
    feed: pickHttpUrl(item, ALIASES.feed, index, 'feed', errors),
    icon: pickHttpUrl(item, ALIASES.icon, index, 'icon', errors),
    avatar: pickHttpUrl(item, ALIASES.avatar, index, 'avatar', errors),
    archs: pickArchs(item),
    since: dateOnly(pickString(item, ALIASES.since) ?? undefined) ?? dateOnly(new Date())!,
    comment: pickString(item, ALIASES.comment),
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

export function importRoutes() {
  const app = new Hono<AppEnv>()

  app.post('/api/admin/import', async (c) => {
    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')
    const { raw, groupOf } = collectItems(body)
    if (raw.length === 0) return jsonError(400, 'empty_input', '未识别到可导入条目')

    const errors: ImportError[] = []
    const items: Normalized[] = []
    raw.forEach((r, i) => {
      const n = normalizeItem(r, groupOf(i), i, errors)
      if (n) items.push(n)
    })

    const createdGroups = new Set<string>()

    // 分组：一次读全量组表，缺的一次 batch 补齐（OR IGNORE 兜住并发创建的 groups.name 唯一索引）
    const names = [...new Set(items.map((it) => it.group ?? '未分组'))]
    const existingGroups = await c.env.DB.prepare('SELECT id, name FROM groups').all<{ id: number; name: string }>()
    const groupIdByName = new Map(existingGroups.results.map((g) => [g.name, g.id]))
    const missing = names.filter((n) => !groupIdByName.has(n))
    if (missing.length > 0) {
      const nextSort = existingGroups.results.length
      await c.env.DB.batch(
        missing.map((name, i) =>
          c.env.DB.prepare('INSERT OR IGNORE INTO groups (name, sort) VALUES (?, ?)').bind(name, nextSort + i),
        ),
      )
      // 回查实际行（并发下部分 INSERT 可能被唯一索引忽略）；D1 单查询最多 100 个参数，必须分片
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100)
        const created = await c.env.DB.prepare(
          `SELECT id, name FROM groups WHERE name IN (${chunk.map(() => '?').join(',')})`,
        )
          .bind(...chunk)
          .all<{ id: number; name: string }>()
        for (const g of created.results) {
          groupIdByName.set(g.name, g.id)
          createdGroups.add(g.name)
        }
      }
      const failed = missing.filter((n) => !groupIdByName.has(n))
      if (failed.length > 0) {
        return jsonError(500, 'group_create_failed', `分组「${failed[0]}」创建失败`)
      }
    }

    // 已存在链接：一次 IN 查询拿全量集合
    const links = items.map((it) => it.link)
    const existed = new Set<string>()
    for (let i = 0; i < links.length; i += 100) {
      const chunk = links.slice(i, i + 100)
      const rows = await c.env.DB.prepare(
        `SELECT link FROM friends WHERE link IN (${chunk.map(() => '?').join(',')})`,
      )
        .bind(...chunk)
        .all<{ link: string }>()
      for (const r of rows.results) existed.add(r.link)
    }

    // 排序位：每目标组一条聚合查询，导入时按序自增
    const sortBase = new Map<number, number>()
    const targetGroupIds = [...new Set(items.map((it) => groupIdByName.get(it.group ?? '未分组')!))]
    for (let i = 0; i < targetGroupIds.length; i += 100) {
      const chunk = targetGroupIds.slice(i, i + 100)
      const rows = await c.env.DB.prepare(
        `SELECT group_id, COALESCE(MAX(sort), -1) + 1 AS next FROM friends WHERE group_id IN (${chunk.map(() => '?').join(',')}) GROUP BY group_id`,
      )
        .bind(...chunk)
        .all<{ group_id: number; next: number }>()
      for (const r of rows.results) sortBase.set(r.group_id, r.next)
    }
    const sortCursor = new Map<number, number>()
    const nextSortFor = (gid: number) => {
      const cur = sortCursor.get(gid) ?? sortBase.get(gid) ?? 0
      sortCursor.set(gid, cur + 1)
      return cur
    }

    // 插入：batch 分片执行。缺省字段保留旧值，但显式出现过的分组/入圈/状态才更新。
    let imported = 0
    let updated = 0
    const seen = new Set<string>()
    const stmts = items.map((it) => {
      const groupId = groupIdByName.get(it.group ?? '未分组')!
      const isUpdate = existed.has(it.link) || seen.has(it.link)
      seen.add(it.link)
      if (isUpdate) updated++
      else imported++
      return c.env.DB.prepare(
        `INSERT INTO friends (group_id, author, nickname, title, "desc", link, feed, icon, avatar, archs, since, comment, in_circle, status, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(link) DO UPDATE SET
           author = CASE WHEN ? THEN excluded.author ELSE author END,
           nickname = COALESCE(excluded.nickname, nickname),
           title = COALESCE(excluded.title, title),
           "desc" = COALESCE(excluded."desc", "desc"),
           feed = COALESCE(excluded.feed, feed),
           icon = COALESCE(excluded.icon, icon),
           avatar = COALESCE(excluded.avatar, avatar),
           archs = COALESCE(excluded.archs, archs),
           comment = COALESCE(excluded.comment, comment),
           in_circle = CASE WHEN ? THEN excluded.in_circle ELSE in_circle END,
           group_id = CASE WHEN ? THEN excluded.group_id ELSE group_id END,
           status = CASE WHEN ? THEN excluded.status ELSE status END,
           updated_at = datetime('now')`,
      ).bind(
        groupId,
        it.author,
        it.nickname,
        it.title,
        it.desc,
        it.link,
        it.feed,
        it.icon,
        it.avatar,
        it.archs ? JSON.stringify(it.archs) : null,
        it.since,
        it.comment,
        it.inCircle === undefined ? 1 : it.inCircle ? 1 : 0,
        it.status ?? 'active',
        nextSortFor(groupId),
        it.authorProvided ? 1 : 0,
        it.inCircle !== undefined ? 1 : 0,
        it.group !== undefined ? 1 : 0,
        it.status !== undefined ? 1 : 0,
      )
    })
    for (let i = 0; i < stmts.length; i += 50) {
      await c.env.DB.batch(stmts.slice(i, i + 50))
    }

    return c.json({
      imported,
      updated,
      skipped: errors.length,
      groupsCreated: createdGroups.size,
      errors: errors.slice(0, 20),
    })
  })

  return app
}
