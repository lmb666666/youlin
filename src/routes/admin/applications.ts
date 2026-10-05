import { Hono } from 'hono'
import { z } from 'zod'
import { jsonError, readJson } from '../../util/http'
import { isoUtc, dateOnly } from '../../util/time'
import { triggerRebuild } from '../../rebuild'
import { ensureGroupByName } from '../apply'
import type { AppEnv } from '../../types'

/**
 * 申请队列（DESIGN §5/§7）：
 *   GET  /api/admin/applications?status=pending|approved|rejected|all
 *   POST /api/admin/applications/:id/approve  通过 → 建友链（可选分组/字段覆盖）+ 可选触发重建
 *   POST /api/admin/applications/:id/reject   { reason }
 *   POST /api/admin/rebuild                   手动触发接入方重建
 */

interface ApplicationRow {
  id: number
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

function shape(r: ApplicationRow) {
  return {
    id: r.id,
    siteName: r.site_name,
    author: r.author ?? undefined,
    link: r.link,
    avatar: r.avatar ?? undefined,
    feed: r.feed ?? undefined,
    desc: r.desc ?? undefined,
    contact: r.contact ?? undefined,
    note: r.note ?? undefined,
    backlink: {
      ok: r.backlink_ok === null ? null : r.backlink_ok === 1,
      checkedAt: isoUtc(r.backlink_checked_at) ?? null,
      detail: r.backlink_detail ?? null,
    },
    status: r.status,
    reviewNote: r.review_note ?? undefined,
    createdAt: isoUtc(r.created_at),
    reviewedAt: isoUtc(r.reviewed_at) ?? undefined,
  }
}

const approveSchema = z
  .object({
    groupId: z.number().int().positive().optional(),
    // 可编辑后再入库（DESIGN §7：字段自动填充，可编辑）
    author: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
    desc: z.string().max(2000).optional(),
    feed: z.union([z.string().url().max(2048), z.literal('')]).optional(),
    avatar: z.union([z.string().url().max(2048), z.literal('')]).optional(),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    rebuild: z.boolean().optional(),
  })
  .strict()

export function applicationRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/applications', async (c) => {
    const status = c.req.query('status') ?? 'pending'
    const allowed = ['pending', 'approved', 'rejected', 'all']
    if (!allowed.includes(status)) return jsonError(400, 'invalid_status', `status 须为 ${allowed.join(' / ')}`)
    const stmt = c.env.DB.prepare(
      `SELECT * FROM applications ${status === 'all' ? '' : 'WHERE status = ?'} ORDER BY created_at DESC, id DESC LIMIT 200`,
    )
    const rows =
      status === 'all'
        ? await stmt.all<ApplicationRow>()
        : await stmt.bind(status).all<ApplicationRow>()
    return c.json({ applications: rows.results.map(shape) })
  })

  app.post('/api/admin/applications/:id/approve', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const body = await readJson(c)
    const parsed = approveSchema.safeParse(body ?? {})
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败')
    const overrides = parsed.data

    const app_ = await c.env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first<ApplicationRow>()
    if (!app_) return jsonError(404, 'not_found', '申请不存在')
    if (app_.status !== 'pending') return jsonError(409, 'already_reviewed', `该申请已处理（${app_.status}）`)

    const dup = await c.env.DB.prepare('SELECT id FROM friends WHERE link = ?').bind(app_.link).first<{ id: number }>()
    if (dup) return jsonError(409, 'duplicate_link', `该链接已在友链中（#${dup.id}），可先删除旧记录再通过`)

    const groupId = overrides.groupId ?? (await ensureGroupByName(c.env.DB, '未分组'))
    const groupExists = await c.env.DB.prepare('SELECT id FROM groups WHERE id = ?').bind(groupId).first()
    if (!groupExists) return jsonError(400, 'unknown_group', '分组不存在')

    const cfg = c.get('cfg')
    const res = await c.env.DB.prepare(
      `INSERT INTO friends (group_id, author, title, "desc", link, feed, avatar, since, in_circle, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
      .bind(
        groupId,
        overrides.author ?? app_.author ?? app_.site_name,
        overrides.title ?? app_.site_name,
        overrides.desc ?? app_.desc,
        app_.link,
        overrides.feed === '' ? null : (overrides.feed ?? app_.feed),
        overrides.avatar === '' ? null : (overrides.avatar ?? app_.avatar),
        overrides.since ?? dateOnly(new Date())!,
        app_.note,
      )
      .run()
    const friendId = Number(res.meta.last_row_id)

    const nowDb = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await c.env.DB.prepare('UPDATE applications SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?')
      .bind('approved', `通过（友链 #${friendId}）`, nowDb, id)
      .run()

    // 通过后可选触发接入方重建（显式请求或 rebuild.auto + enabled）
    let rebuild: { triggered: boolean; provider?: string; debounced?: boolean; error?: string } | null = null
    const wantRebuild = overrides.rebuild === true || (cfg.rebuild.enabled && cfg.rebuild.auto)
    if (wantRebuild && cfg.rebuild.enabled) {
      rebuild = await triggerRebuild(c.env, cfg, `application:${id}`)
    }

    return c.json({ ok: true, friendId, rebuild })
  })

  app.post('/api/admin/applications/:id/reject', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const body = await readJson(c)
    const parsed = z.object({ reason: z.string().max(2000).optional() }).strict().safeParse(body ?? {})
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败')

    const app_ = await c.env.DB.prepare('SELECT id, status FROM applications WHERE id = ?').bind(id).first<{ id: number; status: string }>()
    if (!app_) return jsonError(404, 'not_found', '申请不存在')
    if (app_.status !== 'pending') return jsonError(409, 'already_reviewed', `该申请已处理（${app_.status}）`)

    const nowDb = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await c.env.DB.prepare('UPDATE applications SET status = ?, review_note = ?, reviewed_at = ? WHERE id = ?')
      .bind('rejected', parsed.data.reason ?? null, nowDb, id)
      .run()
    return c.json({ ok: true })
  })

  // 手动触发接入方重建（DESIGN §5）
  app.post('/api/admin/rebuild', async (c) => {
    const cfg = c.get('cfg')
    if (!cfg.rebuild.enabled) return jsonError(400, 'rebuild_disabled', '重建功能未启用（rebuild.enabled）')
    const body = await readJson(c)
    const parsed = z.object({ reason: z.string().max(200).optional() }).strict().safeParse(body ?? {})
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败')
    const result = await triggerRebuild(c.env, cfg, parsed.data.reason ?? 'manual')
    if (result.triggered) return c.json({ ok: true, provider: result.provider })
    if (result.debounced) return jsonError(429, 'rebuild_debounced', '触发过于频繁（防抖中），请稍后再试')
    if (result.error === 'webhook_url_missing' || result.error === 'github_repo_missing' || result.error === 'github_pat_missing') {
      return jsonError(400, 'rebuild_misconfigured', `重建配置不完整：${result.error}`)
    }
    return jsonError(502, 'rebuild_failed', `触发失败：${result.error}`)
  })

  return app
}
