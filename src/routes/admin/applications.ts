import { Hono } from 'hono'
import { z } from 'zod'
import { jsonError, readJson } from '../../util/http'
import { isoUtc, dateOnly } from '../../util/time'
import { dateYMD, httpUrl } from '../../util/validate'
import { linkVariants } from '../../util/link'
import { triggerRebuild } from '../../rebuild'
import { ensureGroupByName, findGroupById } from '../../repositories/groups'
import {
  approveApplication,
  findApplicationById,
  findFriendIdByLinks,
  listApplications,
  rejectApplication,
  type FriendInsert,
} from '../../repositories/applications'
import type { ApplicationRow } from '../../server/schema'
import type { AppEnv } from '../../types'

/**
 * 申请队列（DESIGN §5/§7）：
 *   GET  /api/admin/applications?status=pending|approved|rejected|all
 *   POST /api/admin/applications/:id/approve  通过 → 建友链（可选分组/字段覆盖）+ 可选触发重建
 *   POST /api/admin/applications/:id/reject   { reason }
 *   POST /api/admin/rebuild                   手动触发接入方重建
 */

function shape(r: ApplicationRow) {
  return {
    id: r.id,
    siteName: r.siteName,
    author: r.author ?? undefined,
    link: r.link,
    avatar: r.avatar ?? undefined,
    feed: r.feed ?? undefined,
    desc: r.desc ?? undefined,
    contact: r.contact ?? undefined,
    note: r.note ?? undefined,
    backlink: {
      ok: r.backlinkOk === null ? null : r.backlinkOk === 1,
      checkedAt: isoUtc(r.backlinkCheckedAt) ?? null,
      detail: r.backlinkDetail ?? null,
    },
    status: r.status,
    reviewNote: r.reviewNote ?? undefined,
    createdAt: isoUtc(r.createdAt),
    reviewedAt: isoUtc(r.reviewedAt) ?? undefined,
  }
}

const approveSchema = z
  .object({
    groupId: z.number().int().positive().optional(),
    // 可编辑后再入库（DESIGN §7：字段自动填充，可编辑）
    author: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
    desc: z.string().max(2000).optional(),
    // 与 friends 表单同一校验口径（httpUrl），放行 javascript: 等任意 scheme 会流入公开接口
    feed: z.union([httpUrl, z.literal('')]).optional(),
    avatar: z.union([httpUrl, z.literal('')]).optional(),
    since: dateYMD.optional(),
    rebuild: z.boolean().optional(),
  })
  .strict()

export function applicationRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/applications', async (c) => {
    const status = c.req.query('status') ?? 'pending'
    const allowed = ['pending', 'approved', 'rejected', 'all'] as const
    if (!allowed.includes(status as (typeof allowed)[number])) {
      return jsonError(400, 'invalid_status', `status 须为 ${allowed.join(' / ')}`)
    }
    return c.json({
      applications: listApplications(c.env.DB, status as (typeof allowed)[number]).map(shape),
    })
  })

  app.post('/api/admin/applications/:id/approve', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return jsonError(400, 'invalid_id', 'id 不合法')
    const body = await readJson(c)
    const parsed = approveSchema.safeParse(body ?? {})
    if (!parsed.success) return jsonError(400, 'validation_failed', '字段校验失败')
    const overrides = parsed.data

    const app_ = findApplicationById(c.env.DB, id)
    if (!app_) return jsonError(404, 'not_found', '申请不存在')
    if (app_.status !== 'pending') return jsonError(409, 'already_reviewed', `该申请已处理（${app_.status}）`)

    const dupId = findFriendIdByLinks(c.env.DB, linkVariants(app_.link))
    if (dupId !== null) return jsonError(409, 'duplicate_link', `该链接已在友链中（#${dupId}），可先删除旧记录再通过`)

    const groupId = overrides.groupId ?? ensureGroupByName(c.env.DB, '未分组')
    if (!findGroupById(c.env.DB, groupId)) return jsonError(400, 'unknown_group', '分组不存在')

    const cfg = c.get('cfg')
    const nowDb = new Date().toISOString().slice(0, 19).replace('T', ' ')
    // 覆盖值为空串时回退到申请值/站点名；空作者会破坏公开接口的 author 必填契约
    const author = overrides.author?.trim() || app_.author?.trim() || app_.siteName.trim()
    const title = overrides.title?.trim() || app_.siteName.trim()
    const friend: Omit<FriendInsert, 'groupId'> = {
      author,
      title,
      desc: overrides.desc ?? app_.desc,
      link: app_.link,
      feed: overrides.feed === '' ? null : (overrides.feed ?? app_.feed),
      avatar: overrides.avatar === '' ? null : (overrides.avatar ?? app_.avatar),
      since: overrides.since ?? dateOnly(new Date())!,
      inCircle: 1,
      comment: app_.note,
    }
    const friendId = approveApplication(c.env.DB, id, groupId, friend, nowDb)

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

    const app_ = findApplicationById(c.env.DB, id)
    if (!app_) return jsonError(404, 'not_found', '申请不存在')
    if (app_.status !== 'pending') return jsonError(409, 'already_reviewed', `该申请已处理（${app_.status}）`)

    const nowDb = new Date().toISOString().slice(0, 19).replace('T', ' ')
    rejectApplication(c.env.DB, id, parsed.data.reason ?? null, nowDb)
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
    if (result.debounced) return jsonError(429, 'rebuild_debounced', '触发过于频繁，请稍后再试')
    if (result.error === 'webhook_url_missing' || result.error === 'github_repo_missing' || result.error === 'github_pat_missing') {
      return jsonError(400, 'rebuild_misconfigured', `重建配置不完整：${result.error}`)
    }
    return jsonError(502, 'rebuild_failed', `触发失败：${result.error}`)
  })

  return app
}
