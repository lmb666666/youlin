import { Hono } from 'hono'
import { jsonError, readJson } from '../../util/http'
import { dateOnly } from '../../util/time'
import type { AppEnv } from '../../types'

/**
 * 数据导入（DESIGN §5 POST /api/admin/import）
 * 接受"任意来源 JSON"：常见字段别名做映射，按 link 去重 upsert（缺省字段保留旧值）。
 */

interface Normalized {
  group: string | null
  author: string
  title: string | null
  desc: string | null
  link: string
  feed: string | null
  icon: string | null
  avatar: string | null
  archs: string[] | null
  since: string
  comment: string | null
  inCircle: boolean
}

/** 字段别名表（从左到右取第一个非空值） */
const ALIASES = {
  link: ['link', 'url', 'site', 'siteUrl', 'siteLink', 'homepage', 'home'],
  author: ['author', 'name', 'nickName', 'nickname', 'owner', 'blogger'],
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

function normalizeItem(raw: unknown, fallbackGroup: string | null, index: number, errors: { index: number; message: string }[]): Normalized | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ index, message: '条目须为 JSON 对象' })
    return null
  }
  const item = raw as Record<string, unknown>
  const link = pickString(item, ALIASES.link)
  if (!link || !/^https?:\/\//.test(link)) {
    errors.push({ index, message: '缺少合法的站点链接（link/url/site…）' })
    return null
  }
  return {
    group: pickString(item, ALIASES.group) ?? fallbackGroup,
    author: pickString(item, ALIASES.author) ?? hostOf(link),
    title: pickString(item, ALIASES.title),
    desc: pickString(item, ALIASES.desc),
    link,
    feed: pickString(item, ALIASES.feed),
    icon: pickString(item, ALIASES.icon),
    avatar: pickString(item, ALIASES.avatar),
    archs: pickArchs(item),
    since: dateOnly(pickString(item, ALIASES.since) ?? undefined) ?? dateOnly(new Date())!,
    comment: pickString(item, ALIASES.comment),
    inCircle: item.inCircle === undefined ? true : Boolean(item.inCircle),
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

    const errors: { index: number; message: string }[] = []
    const items: Normalized[] = []
    raw.forEach((r, i) => {
      const n = normalizeItem(r, groupOf(i), i, errors)
      if (n) items.push(n)
    })

    // 分组：按名查/建（导入形状里给组名即建组；无组名的归「未分组」）
    const createdGroups = new Set<string>()
    const groupIdByName = new Map<string, number>()
    const ensureGroup = async (name: string): Promise<number> => {
      const known = groupIdByName.get(name)
      if (known !== undefined) return known
      const row = await c.env.DB.prepare('SELECT id FROM groups WHERE name = ?').bind(name).first<{ id: number }>()
      if (row) {
        groupIdByName.set(name, row.id)
        return row.id
      }
      const next = await c.env.DB.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM groups').first<{ next: number }>()
      const res = await c.env.DB.prepare('INSERT INTO groups (name, sort) VALUES (?, ?)').bind(name, next?.next ?? 0).run()
      const id = Number(res.meta.last_row_id)
      groupIdByName.set(name, id)
      createdGroups.add(name)
      return id
    }

    let imported = 0
    let updated = 0
    for (const it of items) {
      const groupId = await ensureGroup(it.group ?? '未分组')
      const existed = await c.env.DB.prepare('SELECT 1 AS x FROM friends WHERE link = ?').bind(it.link).first()
      await c.env.DB.prepare(
        `INSERT INTO friends (group_id, author, title, "desc", link, feed, icon, avatar, archs, since, comment, in_circle, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM friends WHERE group_id = ?))
         ON CONFLICT(link) DO UPDATE SET
           author = COALESCE(excluded.author, author),
           title = COALESCE(excluded.title, title),
           "desc" = COALESCE(excluded."desc", "desc"),
           feed = COALESCE(excluded.feed, feed),
           icon = COALESCE(excluded.icon, icon),
           avatar = COALESCE(excluded.avatar, avatar),
           archs = COALESCE(excluded.archs, archs),
           comment = COALESCE(excluded.comment, comment),
           in_circle = excluded.in_circle,
           group_id = excluded.group_id,
           updated_at = datetime('now')`,
      )
        .bind(
          groupId, it.author, it.title, it.desc, it.link, it.feed, it.icon, it.avatar,
          it.archs ? JSON.stringify(it.archs) : null, it.since, it.comment, it.inCircle ? 1 : 0, groupId,
        )
        .run()
      if (existed) updated++
      else imported++
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
