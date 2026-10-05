import type { Env, AppConfig } from '../types'

/**
 * 出站 HTTP（抓取/体检/反链/申请共用）：
 *  - UA 模板 {site.url} 替换；超时 AbortSignal.timeout
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

export function userAgent(cfg: AppConfig): string {
  return cfg.crawl.userAgent.replace('{site.url}', cfg.site.url || '')
}

export async function fetchRemote(env: Env, opts: FetchOptions): Promise<FetchResult> {
  void env
  const { cfg } = opts
  const started = Date.now()
  const proxy = cfg.proxy.url
  const mode = cfg.proxy.mode

  const attempt = async (url: string): Promise<FetchResult> => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': userAgent(cfg),
          Accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.8',
          ...opts.headers,
        },
        signal: AbortSignal.timeout(opts.timeoutSeconds * 1000),
      })
      const body = res.status === 304 ? null : await res.text()
      return {
        ok: res.ok,
        status: res.status,
        headers: res.headers,
        body,
        finalUrl: res.url || url,
        latencyMs: Date.now() - started,
      }
    } catch (e) {
      return {
        ok: false,
        status: 0,
        headers: new Headers(),
        body: null,
        finalUrl: url,
        latencyMs: Date.now() - started,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  if (mode === 'always' && proxy) return attempt(proxy + opts.url)
  const direct = await attempt(opts.url)
  // fallback：直连网络层失败（拿到任何 HTTP 状态码都不算）再走代理
  if (direct.error && mode === 'fallback' && proxy) return attempt(proxy + opts.url)
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

