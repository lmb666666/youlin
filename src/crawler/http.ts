import type { Env, AppConfig } from '../types'
import { isPrivateIp } from '../util/ip'

/**
 * 出站 HTTP（抓取/体检/反链/申请共用）：
 *  - UA 模板 {site.url} 替换；超时 AbortSignal.timeout
 *  - 内网/环回地址防护：Workers 平台本就拦截私网出站，这里补齐 Node 自托管路径
 *  - 重定向 manual 逐跳校验（follow 会把重定向目标直接交给平台，Node 上可被跳进内网）
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
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (NON_PUBLIC_HOST.test(host)) return true
  return isPrivateIp(host)
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
  const proxy = cfg.proxy.url
  const mode = cfg.proxy.mode

  // 入口先拦一次：代理回退也不该去抓内网目标（代理地址本身是运维配置，不在此限制）
  if (isPrivateTarget(opts.url)) {
    return {
      ok: false, status: 0, headers: new Headers(), body: null, finalUrl: opts.url,
      latencyMs: Date.now() - started, error: '目标地址不可抓取（内网或非 http(s) 地址）',
    }
  }

  const attempt = async (url: string, viaProxy: boolean): Promise<FetchResult> => {
    const fail = (error: string): FetchResult => ({
      ok: false, status: 0, headers: new Headers(), body: null, finalUrl: url,
      latencyMs: Date.now() - started, error,
    })
    try {
      let current = url
      for (let hop = 0; ; hop++) {
        // 首跳走代理时不校验：代理地址是运维配置（常见为本机 127.0.0.1 的代理），
        // 只校验入口处的抓取目标；重定向后的目标一律直连，必须复检
        if ((hop > 0 || !viaProxy) && isPrivateTarget(current)) {
          return fail('目标地址不可抓取（内网或非 http(s) 地址）')
        }
        const res = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': userAgent(cfg),
            Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.8',
            ...opts.headers,
          },
          signal: AbortSignal.timeout(opts.timeoutSeconds * 1000),
        })
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
        if (!location || hop >= MAX_REDIRECTS) {
          const body = await readBodyWithLimit(res)
          // 代理模式下 finalUrl 保持为抓取目标（相对 feed 发现等要以目标为基准）
          return {
            ok: res.ok, status: res.status, headers: res.headers, body,
            finalUrl: viaProxy ? opts.url : current, latencyMs: Date.now() - started,
          }
        }
        current = new URL(location, current).toString()
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  }

  if (mode === 'always' && proxy) return attempt(proxy + opts.url, true)
  const direct = await attempt(opts.url, false)
  // fallback：直连网络层失败（拿到任何 HTTP 状态码都不算）再走代理
  if (direct.error && mode === 'fallback' && proxy) return attempt(proxy + opts.url, true)
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
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.value) as unknown
  } catch {
    return null
  }
}

export async function runtimeSet(db: Env['DB'], key: string, value: unknown): Promise<void> {
  await db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, JSON.stringify(value))
    .run()
}
