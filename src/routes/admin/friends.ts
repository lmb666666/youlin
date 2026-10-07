import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonError, fieldDetails, readJson } from '../../util/http'
import { httpUrl, dateYMD } from '../../util/validate'
import { isoUtc } from '../../util/time'
import { triggerRebuild } from '../../rebuild'
import type { AppEnv } from '../../types'

/** rebuild.auto 时数据变化后触发接入方重建（不阻塞响应） */
function maybeAutoRebuild(c: Context<AppEnv>, reason: string): void {
  const cfg = c.get('cfg')
  if (cfg.rebuild.enabled && cfg.rebuild.auto) {
    c.executionCtx.waitUntil(triggerRebuild(c.env, cfg, reason))
  }
}

const friendInput = z.object({
  groupId: z.number().int().positive(),
  // 站点名必填；作者选填，缺省时后端用站点名兜底（保持 author 列 NOT NULL 与公开契约不变）
  title: z.string().min(1).max(200),
  author: z.string().max(200).optional().nullable(),
  nickname: z.string().max(200).optional().nullable(),
  desc: z.string().max(2000).optional().nullable(),
  link: httpUrl,
  feed: httpUrl.optional().nullable(),
  icon: httpUrl.optional().nullable(),
  avatar: httpUrl.optional().nullable(),
  archs: z.array(z.string().max(100)).max(20).optional(),
  since: dateYMD,
  comment: z.string().max(2000).optional().nullable(),
  inCircle: z.boolean().optional(),
  status: z.enum(['active', 'hidden']).optional(),
  sort: z.number().int().optional(),
})
const friendPatch = friendInput.partial().extend({
  // 这四列 NOT NULL，不接受 null（author 的空串由兜底逻辑转换）
  groupId: z.number().int().positive().optional(),
  author: z.string().max(200).optional(),
  link: httpUrl.optional(),
  since: dateYMD.optional(),
})

export function friendRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/friends', async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT f.*, g.name AS group_name,
              s.reachable, s.crawlable, s.fail_count, s.checked_at
         FROM friends f
         JOIN groups g ON g.id = f.group_id
         LEFT JOIN source_state s ON s.friend_id = f.id
        ORDER BY g.sort, g.id, f.sort, f.id`,
    ).all<Record<string, unknown>>()
    return c.json({
      friends: rows.results.map((r) => ({
        id: r.id,
        groupId: r.group_id,
        groupName: r.group_name,
        author: r.author,
        nickname: r.nickname ?? undefined,
        title: r.title ?? undefined,
        desc: r.desc ?? undefined,
        link: r.link,
        feed: r.feed ?? undefined,
        icon: r.icon ?? undefined,
        avatar: r.avatar ?? undefined,
        archs: safeArchs(r.archs),
        since: r.since,
        comment: r.comment ?? undefined,
        inCircle: r.in_circle === 1,
        status: r.status,
        sort: r.sort,
        createdAt: isoUtc(r.created_at as string),
        updatedAt: isoUtc(r.updated_at as string),
        state:
          r.checked_at == null
            ? null
            : {
                reachable: r.reachable == null ? null : r.reachable === 1,
                crawlable: r.crawlable == null ? null : r.crawlable === 1,
                failCount: r.fail_count ?? 0,
                checkedAt: isoUtc(r.checked_at as string),
              },
      })),
    })
  })

  app.post('/api/admin/friends', async (c) => {
    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')
    const parsed = friendInput.safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    const d = parsed.data

    if (!(await groupExists(c, d.groupId))) return jsonError(400, 'unknown_group', '分组不存在')
    const author = d.author && d.author.trim() !== '' ? d.author.trim() : d.title

    const sort =
      d.sort ??
      ((await c.env.DB.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM friends WHERE group_id = ?')
        .bind(d.groupId)
        .first<{ next: number }>())?.next ?? 0)

    try {
      const res = await c.env.DB.prepare(
        `INSERT INTO friends (group_id, author, nickname, title, "desc", link, feed, icon, avatar, archs, since, comment, in_circle, status, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          d.groupId, author, d.nickname ?? null, d.title, d.desc ?? null, d.link,
          d.feed ?? null, d.icon ?? null, d.avatar ?? null, d.archs ? JSON.stringify(d.archs) : null,
          d.since, d.comment ?? null, d.inCircle === false ? 0 : 1, d.status ?? 'active', sort,
        )
        .run()
      maybeAutoRebuild(c, 'friend:create')
      return c.json({ id: res.meta.last_row_id }, 201)
    } catch (e) {
      if (await isUniqueLinkError(c, e, d.link)) return jsonError(409, 'duplicate_link', '该链接已存在')
      throw e
    }
  })

  app.patch('/api/admin/friends/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')
    const parsed = friendPatch.safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    const d = parsed.data
    const existing = await c.env.DB.prepare('SELECT author, title FROM friends WHERE id = ?')
      .bind(id)
      .first<{ author: string; title: string | null }>()
    if (!existing) return jsonError(404, 'not_found', '友链不存在')
    if (d.groupId !== undefined && !(await groupExists(c, d.groupId))) {
      return jsonError(400, 'unknown_group', '分组不存在')
    }

    const sets: string[] = ['updated_at = datetime(\'now\')']
    const binds: unknown[] = []
    const col: Record<string, string> = {
      groupId: 'group_id', author: 'author', nickname: 'nickname', title: 'title', desc: '"desc"',
      link: 'link', feed: 'feed', icon: 'icon', avatar: 'avatar', since: 'since', comment: 'comment',
      status: 'status', sort: 'sort',
    }
    for (const [k, column] of Object.entries(col)) {
      const v = (d as Record<string, unknown>)[k]
      // 空作者不直接落库，走下面的站点名兜底
      const deferred = k === 'author' && typeof v === 'string' && v.trim() === ''
      if (v !== undefined && !deferred) {
        sets.push(`${column} = ?`)
        binds.push(v)
      }
    }
    if (d.author !== undefined && d.author.trim() === '') {
      // 作者清空 → 用站点名兜底（新提交的 title 优先，其次原值）
      const fallback = d.title ?? existing.title
      if (!fallback || fallback.trim() === '') {
        return jsonError(400, 'author_required', '作者与站点名不能同时为空')
      }
      sets.push('author = ?')
      binds.push(fallback.trim())
    }
    if (d.archs !== undefined) {
      sets.push('archs = ?')
      binds.push(JSON.stringify(d.archs))
    }
    if (d.inCircle !== undefined) {
      sets.push('in_circle = ?')
      binds.push(d.inCircle ? 1 : 0)
    }

    try {
      await c.env.DB.prepare(`UPDATE friends SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run()
    } catch (e) {
      if (await isUniqueLinkError(c, e, d.link)) return jsonError(409, 'duplicate_link', '该链接已存在')
      throw e
    }
    maybeAutoRebuild(c, 'friend:update')
    return c.json({ ok: true })
  })

  app.delete('/api/admin/friends/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM articles WHERE friend_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM source_state WHERE friend_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM friends WHERE id = ?').bind(id),
    ])
    maybeAutoRebuild(c, 'friend:delete')
    return c.json({ ok: true })
  })

  // 拖拽排序：批量写入新 sort（可选同时改分组）
  app.post('/api/admin/friends/reorder', async (c) => {
    const body = await readJson(c)
    const parsed = z
      .object({ items: z.array(z.object({ id: z.number().int(), sort: z.number().int(), groupId: z.number().int().optional() })).min(1) })
      .safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败', fieldDetails(parsed.error.issues))
    await c.env.DB.batch(
      parsed.data.items.map((it) =>
        it.groupId === undefined
          ? c.env.DB.prepare('UPDATE friends SET sort = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(it.sort, it.id)
          : c.env.DB.prepare('UPDATE friends SET sort = ?, group_id = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(it.sort, it.groupId, it.id),
      ),
    )
    return c.json({ ok: true })
  })

  return app
}

function safeArchs(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : undefined
  } catch {
    return undefined
  }
}

async function groupExists(c: Context<AppEnv>, id: number): Promise<boolean> {
  return Boolean(await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(id).first())
}

/** 唯一键冲突是否来自 friends.link（而非其他索引） */
async function isUniqueLinkError(c: Context<AppEnv>, err: unknown, link?: string): Promise<boolean> {
  const msg = String((err as Error)?.message ?? err)
  if (!/UNIQUE constraint failed/i.test(msg)) return false
  if (link === undefined) return true
  const row = await c.env.DB.prepare('SELECT id FROM friends WHERE link = ?').bind(link).first()
  return row !== null
}
