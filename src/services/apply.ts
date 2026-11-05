import { AppError } from '../errors'
import { applyFormSchema, type ApplyResult, type BacklinkVerdict } from '@youlin/contracts'
import { fieldDetails, isUniqueConstraintError } from '../util/http'
import { clampText } from '../util/str'
import { fetchRemote } from '../crawler/http'
import { htmlContainsBacklink, normalizeDomain } from '../crawler/linkcheck'
import { dateOnly, dbTime } from '../util/time'
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
import type { AppConfig, Db, Env } from '../types'

/**
 * 友链申请（DESIGN §4.3）：字段校验 → 限流 → 去重 → 人机验证 → 反链 → 落库。
 * 所有拒绝都以 AppError 抛出，HTTP 状态与错误码由统一映射保持稳定。
 */

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

export async function submitApplication(
  db: Db,
  env: Env,
  cfg: AppConfig,
  ip: string,
  raw: unknown,
): Promise<ApplyResult> {
  if (!cfg.apply.enabled) throw new AppError(403, 'apply_disabled', '友链申请通道未开放')

  const parsed = applyFormSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError(400, 'validation_failed', '请检查表单填写', fieldDetails(parsed.error.issues))
  }
  const input = parsed.data

  // 必填字段（apply.requiredFields，服务端权威）
  const missing: Record<string, string> = {}
  for (const f of cfg.apply.requiredFields) {
    if (!KNOWN_FIELDS.includes(f)) continue
    if (!nonEmpty((input as Record<string, unknown>)[f])) missing[f] = `请填写${FIELD_LABELS[f] ?? '该字段'}`
  }
  // 链接是申请与入库的前提，不受必填字段配置影响
  if (!nonEmpty(input.link)) missing['link'] = '请填写站点链接'
  if (Object.keys(missing).length > 0) {
    throw new AppError(400, 'validation_failed', '请检查表单填写', missing)
  }

  const day = new Date().toISOString().slice(0, 10)

  // 限流：每 IP 每天成功提交次数（先查后计，计数在成功提交时 +1）
  if (getApplyRateCount(db, ip, day) >= cfg.apply.rateLimitPerDay) {
    throw new AppError(429, 'rate_limited', `每 IP 每天最多提交 ${cfg.apply.rateLimitPerDay} 次，请明天再试`)
  }

  const link = input.link!.trim()

  // 去重：已在友链表 / 已有待审申请
  const variants = linkVariants(link)
  if (findFriendIdByLinks(db, variants) !== null) {
    throw new AppError(409, 'duplicate_link', '该链接已在友链中')
  }
  if (findPendingApplicationIdByLinks(db, variants) !== null) {
    throw new AppError(409, 'already_pending', '该链接已有待审申请')
  }

  // 人机验证（apply.turnstile；密钥在部署级 Secret）
  if (cfg.apply.turnstile) {
    const token = nonEmpty(input.turnstileToken) ? input.turnstileToken!.trim() : ''
    if (!token) throw new AppError(400, 'validation_failed', '字段校验失败', { turnstileToken: '请完成人机验证' })
    if (!env.TURNSTILE_SECRET) {
      throw new AppError(403, 'turnstile_unconfigured', '服务端未配置人机验证密钥，暂无法提交')
    }
    if (!(await verifyTurnstile(env, env.TURNSTILE_SECRET, token, ip))) {
      throw new AppError(403, 'turnstile_failed', '人机验证未通过，请重试')
    }
  }

  // 反链检测（apply.backlinkPolicy / backlink.enabled）
  let backlink: BacklinkVerdict = { ok: null, detail: null }
  if (cfg.apply.backlinkPolicy !== 'off' && cfg.backlink.enabled) {
    backlink = await checkApplicantBacklink(env, cfg, link)
  }
  if (cfg.apply.backlinkPolicy === 'reject' && backlink.ok !== true) {
    throw new AppError(403, 'backlink_missing', '未检测到指向本站的链接，请先添加友链', {
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
  const nowDb = dbTime(new Date().toISOString())
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

  let status: ApplyResult['status'] = 'pending'
  let applicationId: number

  if (cfg.apply.autoApprove) {
    const groupId = ensureGroupByName(db, '未分组')
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
      const created = createAutoApprovedApplication(db, groupId, friend, application, nowDb)
      applicationId = created.applicationId
      status = 'approved'
    } catch (e) {
      if (isUniqueConstraintError(e)) throw new AppError(409, 'duplicate_link', '该链接已在友链中')
      throw e
    }
  } else {
    applicationId = insertApplication(db, application)
  }

  // 成功才计入限流；顺带清理过期计数
  recordApplySuccess(db, ip, day)

  return { id: applicationId, status, backlink }
}
