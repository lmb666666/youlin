import type { Env, AppConfig } from '../types'

/**
 * 出站 HTTP（抓取/体检/反链共用）：
 *  - UA 模板 {site.url} 替换
 *  - 超时 AbortSignal.timeout
 *  - 代理三模式（off / fallback / always，代理 = 前缀 + 目标 URL）
 */

export interface FetchOptions {
  url: string
  cfg: AppConfig
  timeoutSeconds: number
  headers?: Record<string, string>
  proxyMode?: 'off' | 'fallback' | 'always'
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

function applyProxy(cfg: AppConfig, url: string, mode: 'off' | 'fallback' | 'always'): string {
  if (mode === 'off' || !cfg.proxy.url) return url
  if (mode === 'always' || cfg.proxy.mode === 'always') return cfg.proxy.url + url
  return url // fallback 由调用方重试
}

export function userAgent(cfg: AppConfig): string {
  return cfg.crawl.userAgent.replace('{site.url}', cfg.site.url || '')
}

export async function fetchRemote(env: Env, opts: FetchOptions): Promise<FetchResult> {
  const started = Date.now()
  const mode = opts.proxyMode ?? cfgProxyMode(opts.cfg)
  const doFetch = async (url: string): Promise<Response> =>
    fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': userAgent(opts.cfg),
        Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.8',
        ...opts.headers,
      },
      signal: AbortSignal.timeout(opts.timeoutSeconds * 1000),
    })

  try {
    const url = applyProxy(opts.cfg, opts.url, mode)
    const res = await doFetch(url)
    const body = res.status === 304 ? null : await res.text()
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      body,
      finalUrl: res.url || opts.url,
      latencyMs: Date.now() - started,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // fallback：直连失败（网络层）且配置了代理 → 走代理再试一次
    if (mode === 'fallback' && opts.cfg.proxy.url) {
      try {
        const res = await doFetch(opts.cfg.proxy.url + opts.url)
        const body = res.status === 304 ? null : await res.text()
        return {
          ok: res.ok,
          status: res.status,
          headers: res.headers,
          body,
          finalUrl: res.url || opts.url,
          latencyMs: Date.now() - started,
        }
      } catch (e2) {
        return {
          ok: false,
          status: 0,
          headers: new Headers(),
          body: null,
          finalUrl: opts.url,
          latencyMs: Date.now() - started,
          error: e2 instanceof Error ? e2.message : String(e2),
        }
      }
    }
    return {
      ok: false,
      status: 0,
      headers: new Headers(),
      body: null,
      finalUrl: opts.url,
      latencyMs: Date.now() - started,
      error: message,
    }
  }
}

function cfgProxyMode(cfg: AppConfig): 'off' | 'fallback' | 'always' {
  return cfg.proxy.mode
}

/** 失联退避阶梯（DESIGN §6.5）：失联天数 ≥ 阶梯天数 → 对应间隔小时；否则常规间隔 */
export function nextIntervalHours(unreachableDays: number | null, cfg: AppConfig, baseHours: number): number {
  if (unreachableDays === null) return baseHours
  const ladder = [...cfg.linkCheck.backoffLadder].sort((a, b) => a[0] - b[0])
  let result: number | null = null
  for (const [days, hours] of ladder) {
    if (unreachableDays >= days) result = hours // 取满足条件的最高档
  }
  return result ?? baseHours
}

/** 运行时簿记（轮转进度）：存 settings 表 internal.* 键，不属于应用配置 */
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

export async function runtimeDel(db: Env['DB'], key: string): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run()
}
