import { Hono } from 'hono'
import { z } from 'zod'
import type { AppConfig, AppEnv, Env } from '../types'
import { jsonError, fieldDetails, readJsonLimited, isUniqueConstraintError } from '../util/http'
import { clientIp } from '../util/ip'
import { clampText } from '../util/str'
import { renderApplyPage } from '../apply-page'
import { fetchRemote } from '../crawler/http'
import { htmlContainsBacklink, normalizeDomain } from '../crawler/linkcheck'
import { dateOnly } from '../util/time'
import { httpUrl } from '../util/validate'
import { linkVariants } from '../util/link'
import { ensureGroupByName } from '../repositories/groups'
import {
  createAutoApprovedApplication,
  findFriendIdByLinks,
  findPendingApplicationIdByLinks,
  getApplyRateCount,
  insertApplication,
  recordApplySuccess,
  type ApplicationInsert,
  type FriendInsert,
} from '../repositories/applications'

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

async function verifyTurnstile(env: Env, secret: string, token: string, ip: string): Promise<boolean> {
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  if (ip !== 'local') form.append('remoteip', ip)
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(10_000),
    })
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
    // applications.backlink_detail 列的上限与备份 schema 一致（finalUrl 最长 2048，拼上文字可能超）
    detail: clampText(
      ok ? `在 ${res.finalUrl} 发现指向 ${mine} 的链接` : `未在 ${res.finalUrl} 发现指向 ${mine} 的链接`,
      2000,
    ),
  }
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

    const limited = await readJsonLimited(c, 64 * 1024)
    if (!limited.ok) return limited.response

    const parsed = applySchema.safeParse(limited.value)
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
    if (getApplyRateCount(c.env.DB, ip, day) >= cfg.apply.rateLimitPerDay) {
      return jsonError(429, 'rate_limited', `每 IP 每天最多提交 ${cfg.apply.rateLimitPerDay} 次，请明天再试`)
    }

    const link = input.link!.trim()

    // 去重：已在友链表 / 已有待审申请
    const variants = linkVariants(link)
    if (findFriendIdByLinks(c.env.DB, variants) !== null) {
      return jsonError(409, 'duplicate_link', '该链接已在友链中')
    }
    if (findPendingApplicationIdByLinks(c.env.DB, variants) !== null) {
      return jsonError(409, 'already_pending', '该链接已有待审申请')
    }

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
    const author = nonEmpty(input.author) ? input.author!.trim() : null
    const avatar = nonEmpty(input.avatar) ? input.avatar!.trim() : null
    const feed = nonEmpty(input.feed) ? input.feed!.trim() : null
    const desc = nonEmpty(input.desc) ? input.desc!.trim() : null
    const contact = nonEmpty(input.contact) ? input.contact!.trim() : null
    const note = nonEmpty(input.note) ? input.note!.trim() : null
    const backlinkOk = backlink.ok === null ? null : backlink.ok ? 1 : 0
    const nowDb = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const application: ApplicationInsert = {
      siteName,
      author,
      link,
      avatar,
      feed,
      desc,
      contact,
      note,
      backlinkOk,
      backlinkCheckedAt: backlink.detail === null ? null : nowDb,
      backlinkDetail: backlink.detail,
      status: cfg.apply.autoApprove ? 'approved' : 'pending',
      reviewNote: null,
      reviewedAt: null,
    }

    let status: 'pending' | 'approved' = 'pending'
    let applicationId: number

    if (cfg.apply.autoApprove) {
      const groupId = ensureGroupByName(c.env.DB, '未分组')
      const friend: Omit<FriendInsert, 'groupId'> = {
        author: author ?? siteName,
        title: siteName,
        desc,
        link,
        feed,
        avatar,
        since: dateOnly(new Date())!,
        inCircle: 1,
        comment: note,
      }
      // 建友链与写申请在同一事务内完成
      try {
        const created = createAutoApprovedApplication(c.env.DB, groupId, friend, application, nowDb)
        applicationId = created.applicationId
        status = 'approved'
      } catch (e) {
        if (isUniqueConstraintError(e)) return jsonError(409, 'duplicate_link', '该链接已在友链中')
        throw e
      }
    } else {
      applicationId = insertApplication(c.env.DB, application)
    }

    // 成功才计入限流；顺带清理过期计数
    recordApplySuccess(c.env.DB, ip, day)

    return c.json({ id: applicationId, status, backlink }, 201)
  })

  return app
}
