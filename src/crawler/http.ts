import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Env, AppConfig } from '../types'
import { isPrivateIp } from '../util/ip'
import { guardedDispatcher } from '../server/net'
import { findSettingValue, setSettingValue } from '../repositories/settings'

/**
 * 出站 HTTP（抓取/体检/反链/申请共用）：
 *  - UA 模板 {site.url} 替换；超时 AbortSignal.timeout
 *  - 内网/环回地址防护：DNS 解析与连接绑定在 guardedDispatcher 上
 *  - 重定向 manual 逐跳校验（follow 会把重定向目标直接交给 fetch，可能跳进内网）
 *  - 响应体上限：超大 RSS/首页直接按失败处理，防止打爆内存
 *  - 代理策略统一走 cfg.proxy.mode（off / fallback / always）
 */

export interface FetchOptions {
  url: string
  cfg: AppConfig
  timeoutSeconds: number
  headers?: Record<string, string>
}

export interface FetchResult {
  ok: boolean
  status: number
  headers: Headers
  body: string | null
  finalUrl: string
  latencyMs: number
  error?: string
  /** 失败原因是安全策略而不是网络错误：代理回退不得重试 */
  blocked?: boolean
}

const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 5

const NON_PUBLIC_HOST = /(localhost|\.(local|internal|home\.arpa))$/i

/** 目标是否不可抓取：非 http(s) 协议、内网/环回主机名或 IP */
export function isPrivateTarget(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (NON_PUBLIC_HOST.test(host)) return true
  if (host.includes(':')) return isPrivateIp(host)
  if (!host.includes('.')) return true // Docker/单标签主机名（redis、metadata 等）一律不抓
  return isPrivateIp(host)
}

/** 代理首跳不经过 guardedDispatcher，先在本地解析目标，任何私网结果都拒绝 */
async function assertProxyTargetPublic(url: string): Promise<void> {
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (isIP(host)) {
    if (isPrivateIp(host)) throw Object.assign(new Error(`目标地址不可抓取（内网或非 http(s) 地址）`), { name: 'BlockedPrivateAddress' })
    return
  }
  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error(`无法解析目标地址：${host}`)
  }
  const bad = addresses.find((a) => isPrivateIp(a.address))
  if (bad) {
    throw Object.assign(new Error(`目标地址解析到内网/环回地址（${bad.address}）`), { name: 'BlockedPrivateAddress' })
  }
}

function isPolicyError(err: unknown): boolean {
  const e = err as { name?: string; message?: string; cause?: { name?: string; message?: string } } | undefined
  const name = e?.cause?.name ?? e?.name
  const message = e?.cause?.message ?? e?.message ?? ''
  return name === 'BlockedPrivateAddress' || message.includes('目标地址不可抓取') || message.includes('内网/环回')
}

/** 读取响应体并限制大小；超限时中止读取（feed/首页远用不到这个量级） */
async function readBodyWithLimit(res: Response): Promise<string | null> {
  if (res.status === 304) return null
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error(`响应体超过 ${MAX_BODY_BYTES / 1024 / 1024} MB 上限`)
  }
  if (!res.body) return await res.text()
  const reader = res.body.getReader()
  try {
    const decoder = new TextDecoder()
    let total = 0
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) throw new Error(`响应体超过 ${MAX_BODY_BYTES / 1024 / 1024} MB 上限`)
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    reader.cancel().catch(() => {})
  }
}

export function userAgent(cfg: AppConfig): string {
  return cfg.crawl.userAgent.replace('{site.url}', cfg.site.url || '')
}

export async function fetchRemote(env: Env, opts: FetchOptions): Promise<FetchResult> {
  void env
  const { cfg } = opts
  const started = Date.now()
  const deadline = started + opts.timeoutSeconds * 1000
  const proxy = cfg.proxy.url
  const mode = cfg.proxy.mode

  // 入口先拦一次：代理回退也不该去抓内网目标（代理地址本身是运维配置，不在此限制）
  if (isPrivateTarget(opts.url)) {
    return {
      ok: false, status: 0, headers: new Headers(), body: null, finalUrl: opts.url,
      latencyMs: Date.now() - started, error: '目标地址不可抓取（内网或非 http(s) 地址）', blocked: true,
    }
  }

  const attempt = async (url: string, viaProxy: boolean): Promise<FetchResult> => {
    let target = url
    const fail = (error: string, blocked = false): FetchResult => ({
      ok: false, status: 0, headers: new Headers(), body: null, finalUrl: target,
      latencyMs: Date.now() - started, error, blocked,
    })
    try {
      if (viaProxy) await assertProxyTargetPublic(url)
      let current = viaProxy ? proxy + url : url
      for (let hop = 0; ; hop++) {
        // 首跳走代理时请求 URL 是代理，但重定向后的目标一律直连，必须复检
        const direct = hop > 0 || !viaProxy
        if (direct && isPrivateTarget(current)) {
          return fail('目标地址不可抓取（内网或非 http(s) 地址）', true)
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) return fail('请求超时')
        const init = {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': userAgent(cfg),
            Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.8',
            ...opts.headers,
          },
          signal: AbortSignal.timeout(remaining),
          ...(direct ? { dispatcher: guardedDispatcher } : {}),
        } as RequestInit & { dispatcher?: unknown }
        const res = await fetch(current, init)
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
        if (!location || hop >= MAX_REDIRECTS) {
          const body = await readBodyWithLimit(res)
          return {
            ok: res.ok, status: res.status, headers: res.headers, body,
            finalUrl: target, latencyMs: Date.now() - started,
          }
        }
        // 相对 Location 必须以目标站点为 base，不能以代理地址为 base
        target = new URL(location, target).toString()
        current = target
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), isPolicyError(e))
    }
  }

  if (mode === 'always' && proxy) return attempt(opts.url, true)
  const direct = await attempt(opts.url, false)
  // fallback：只在网络层失败时重试；安全策略拒绝（如 DNS 指向内网）绝不走代理
  if (direct.error && !direct.blocked && mode === 'fallback' && proxy) return attempt(opts.url, true)
  return direct
}

/** 失联退避阶梯（DESIGN §6.5）：失联天数 ≥ 阶梯天数 → 取满足条件的最高档；否则常规间隔 */
export function nextIntervalHours(unreachableDays: number | null, cfg: AppConfig, baseHours: number): number {
  if (unreachableDays === null) return baseHours
  const ladder = [...cfg.linkCheck.backoffLadder].sort((a, b) => a[0] - b[0])
  let result: number | null = null
  for (const [days, hours] of ladder) {
    if (unreachableDays >= days) result = hours
  }
  return result ?? baseHours
}

/** 运行时簿记（轮转进度 / 清理水位 / 重建防抖）：存 settings 表 internal.* 键，不属于应用配置 */
export async function runtimeGet(db: Env['DB'], key: string): Promise<unknown | null> {
  const value = findSettingValue(db, key)
  if (value === null) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export async function runtimeSet(db: Env['DB'], key: string, value: unknown): Promise<void> {
  setSettingValue(db, key, JSON.stringify(value))
}
