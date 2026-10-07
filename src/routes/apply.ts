import { Hono } from 'hono'
import { z } from 'zod'
import type { AppConfig, AppEnv, Env } from '../types'
import { jsonError, fieldDetails, readJson } from '../util/http'
import { renderApplyPage } from '../apply-page'
import { fetchRemote } from '../crawler/http'
import { htmlContainsBacklink, normalizeDomain } from '../crawler/linkcheck'
import { dateOnly } from '../util/time'
import { httpUrl } from '../util/validate'

/**
 * 友链申请接口（DESIGN §4.3）
 *   GET  /apply   内置申请页（HTML，文案由 site.* / apply.* 驱动）
 *   POST /apply   JSON 提交：400 字段校验 / 403 人机验证或反链拒绝 / 409 重复 / 429 限流
 * 成功 201：{ id, status, backlink: { ok, detail } }
 */

const optionalUrl = z.union([httpUrl, z.literal('')]).optional().nullable()
const optionalText = (max: number) => z.union([z.string().max(max), z.literal('')]).optional().nullable()

const applySchema = z
  .object({
    siteName: optionalText(100),
    // link 容忍缺省/空串：必填与格式提示都走下方中文校验，避免英文 zod 报错泄漏到页面
    link: z.preprocess((v) => (v === '' ? undefined : v), httpUrl.optional()),
    author: optionalText(100),
    avatar: optionalUrl,
    feed: optionalUrl,
    desc: optionalText(2000),
    contact: optionalText(200),
    note: optionalText(2000),
    turnstileToken: z.string().max(4000).optional().nullable(),
  })
  .strict()

const KNOWN_FIELDS = ['siteName', 'link', 'author', 'avatar', 'feed', 'desc', 'contact', 'note']

/** 字段中文名（校验提示用） */
const FIELD_LABELS: Record<string, string> = {
  siteName: '站点名', link: '站点链接', author: '站长昵称', avatar: '头像链接',
  feed: 'RSS 订阅地址', desc: '站点简介', contact: '联系方式', note: '备注',
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}

/** link 的等价写法（尾斜杠差异不应绕过去重） */
function linkVariants(link: string): string[] {
  const noSlash = link.replace(/\/+$/, '')
  return [...new Set([link, noSlash, noSlash + '/'])]
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local'
}

async function verifyTurnstile(env: Env, secret: string, token: string, ip: string): Promise<boolean> {
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  if (ip !== 'local') form.append('remoteip', ip)
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

interface BacklinkVerdict {
  ok: boolean | null
  detail: string | null
}

async function checkApplicantBacklink(env: Env, cfg: AppConfig, link: string): Promise<BacklinkVerdict> {
  const mine = normalizeDomain(cfg.backlink.authorUrl || cfg.site.url)
  if (!mine) return { ok: null, detail: null }
  const res = await fetchRemote(env, { url: link, cfg, timeoutSeconds: cfg.crawl.timeoutSeconds })
  if (res.error || res.status >= 400 || res.body === null) {
    return { ok: null, detail: `无法访问申请站点（${res.error ?? `HTTP ${res.status}`}）` }
  }
  const ok = htmlContainsBacklink(res.body, mine)
  return {
    ok,
    detail: ok ? `在 ${res.finalUrl} 发现指向 ${mine} 的链接` : `未在 ${res.finalUrl} 发现指向 ${mine} 的链接`,
  }
}

/** 审核通过入库时的默认分组（autoApprove 与手动通过共用） */
export async function ensureGroupByName(db: Env['DB'], name: string): Promise<number> {
  const row = await db.prepare('SELECT id FROM groups WHERE name = ?').bind(name).first<{ id: number }>()
  if (row) return row.id
  const next = await db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM groups').first<{ next: number }>()
  const res = await db.prepare('INSERT INTO groups (name, sort) VALUES (?, ?)').bind(name, next?.next ?? 0).run()
  return Number(res.meta.last_row_id)
}

export function applyRoutes() {
  const app = new Hono<AppEnv>()

  // 对外接口通用约定（DESIGN §4）：CORS 全开（自建表单可跨域提交）
  app.use('/apply', async (c, next) => {
    await next()
    const cfg = c.get('cfg')
    if (cfg) c.res.headers.set('Access-Control-Allow-Origin', cfg.api.corsOrigin || '*')
  })

  app.options('/apply', (c) => {
    const cfg = c.get('cfg')
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': cfg.api.corsOrigin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  })

  app.get('/apply', (c) => {
    const cfg = c.get('cfg')
    return new Response(renderApplyPage(cfg), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  })

  app.post('/apply', async (c) => {
    const cfg = c.get('cfg')
    if (!cfg.apply.enabled) return jsonError(403, 'apply_disabled', '友链申请通道未开放')

    const body = await readJson(c)
    if (body === undefined) return jsonError(400, 'invalid_json', '请求体须为 JSON')

    const parsed = applySchema.safeParse(body)
    if (!parsed.success) return jsonError(400, 'validation_failed', '请检查表单填写', fieldDetails(parsed.error.issues))
    const input = parsed.data

    // 必填字段（apply.requiredFields，服务端权威）
    const missing: Record<string, string> = {}
    for (const f of cfg.apply.requiredFields) {
      if (!KNOWN_FIELDS.includes(f)) continue
      if (!nonEmpty((input as Record<string, unknown>)[f])) missing[f] = `请填写${FIELD_LABELS[f] ?? '该字段'}`
    }
    // 链接是申请与入库的前提，不受必填字段配置影响
    if (!nonEmpty(input.link)) missing['link'] = '请填写站点链接'
    if (Object.keys(missing).length > 0) return jsonError(400, 'validation_failed', '请检查表单填写', missing)

    const ip = clientIp(c)
    const day = new Date().toISOString().slice(0, 10)

    // 限流：每 IP 每天成功提交次数（先查后计，计数在成功提交时 +1）
    const rate = await c.env.DB.prepare('SELECT count FROM apply_rate_limit WHERE ip = ? AND day = ?')
      .bind(ip, day)
      .first<{ count: number }>()
    if ((rate?.count ?? 0) >= cfg.apply.rateLimitPerDay) {
      return jsonError(429, 'rate_limited', `每 IP 每天最多提交 ${cfg.apply.rateLimitPerDay} 次，请明天再试`)
    }

    const link = input.link!.trim()

    // 去重：已在友链表 / 已有待审申请
    const variants = linkVariants(link)
    const inFriends = await c.env.DB.prepare(
      `SELECT 1 AS x FROM friends WHERE link IN (${variants.map(() => '?').join(',')}) LIMIT 1`,
    )
      .bind(...variants)
      .first()
    if (inFriends) return jsonError(409, 'duplicate_link', '该链接已在友链中')
    const inPending = await c.env.DB.prepare(
      `SELECT 1 AS x FROM applications WHERE status = 'pending' AND link IN (${variants.map(() => '?').join(',')}) LIMIT 1`,
    )
      .bind(...variants)
      .first()
    if (inPending) return jsonError(409, 'already_pending', '该链接已有待审申请')

    // 人机验证（apply.turnstile；密钥在部署级 Secret）
    if (cfg.apply.turnstile) {
      const token = nonEmpty(input.turnstileToken) ? input.turnstileToken!.trim() : ''
      if (!token) return jsonError(400, 'validation_failed', '字段校验失败', { turnstileToken: '请完成人机验证' })
      if (!c.env.TURNSTILE_SECRET) {
        return jsonError(403, 'turnstile_unconfigured', '服务端未配置人机验证密钥，暂无法提交')
      }
      if (!(await verifyTurnstile(c.env, c.env.TURNSTILE_SECRET, token, ip))) {
        return jsonError(403, 'turnstile_failed', '人机验证未通过，请重试')
      }
    }

    // 反链检测（apply.backlinkPolicy / backlink.enabled）
    let backlink: BacklinkVerdict = { ok: null, detail: null }
    if (cfg.apply.backlinkPolicy !== 'off' && cfg.backlink.enabled) {
      backlink = await checkApplicantBacklink(c.env, cfg, link)
    }
    if (cfg.apply.backlinkPolicy === 'reject' && backlink.ok !== true) {
      return jsonError(403, 'backlink_missing', '未检测到指向本站的链接，请先添加友链', {
        backlink: backlink.detail ?? '未检测',
      })
    }

    // 落库（autoApprove 直接入库并建友链）
    const siteName = nonEmpty(input.siteName) ? input.siteName!.trim() : new URL(link).hostname
    let status: 'pending' | 'approved' = 'pending'
    let friendId: number | null = null
    if (cfg.apply.autoApprove) {
      const groupId = await ensureGroupByName(c.env.DB, '未分组')
      const res = await c.env.DB.prepare(
        `INSERT INTO friends (group_id, author, title, "desc", link, feed, avatar, since, in_circle, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
        .bind(
          groupId,
          nonEmpty(input.author) ? input.author!.trim() : siteName,
          siteName,
          nonEmpty(input.desc) ? input.desc!.trim() : null,
          input.link,
          nonEmpty(input.feed) ? input.feed!.trim() : null,
          nonEmpty(input.avatar) ? input.avatar!.trim() : null,
          dateOnly(new Date())!,
          nonEmpty(input.note) ? input.note!.trim() : null,
        )
        .run()
      friendId = Number(res.meta.last_row_id)
      status = 'approved'
    }

    const nowDb = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const ins = await c.env.DB.prepare(
      `INSERT INTO applications (site_name, author, link, avatar, feed, "desc", contact, note,
                                 backlink_ok, backlink_checked_at, backlink_detail, status, review_note, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        siteName,
        nonEmpty(input.author) ? input.author!.trim() : null,
        link,
        nonEmpty(input.avatar) ? input.avatar!.trim() : null,
        nonEmpty(input.feed) ? input.feed!.trim() : null,
        nonEmpty(input.desc) ? input.desc!.trim() : null,
        nonEmpty(input.contact) ? input.contact!.trim() : null,
        nonEmpty(input.note) ? input.note!.trim() : null,
        backlink.ok === null ? null : backlink.ok ? 1 : 0,
        backlink.detail === null ? null : nowDb,
        backlink.detail,
        status,
        status === 'approved' ? `autoApprove（友链 #${friendId}）` : null,
        status === 'approved' ? nowDb : null,
      )
      .run()

    // 成功才计入限流；顺带清理过期计数
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO apply_rate_limit (ip, day, count) VALUES (?, ?, 1) ON CONFLICT(ip, day) DO UPDATE SET count = count + 1',
      ).bind(ip, day),
      c.env.DB.prepare('DELETE FROM apply_rate_limit WHERE day < ?').bind(day),
    ])

    return c.json({ id: Number(ins.meta.last_row_id), status, backlink }, 201)
  })

  return app
}
