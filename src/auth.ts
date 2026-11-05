import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { AppEnv, Db } from './types'
import { consumeLoginAttempt, resetLoginAttempts } from './repositories/login-rate-limit'

/**
 * 登录会话（DESIGN §5）：
 *   POST /api/admin/login 校验 ADMIN_TOKEN（常数时间）→ 签发 HMAC Cookie
 *   Cookie: youlin_session = base64url(payload) + "." + base64url(HMAC-SHA256(payload, ADMIN_TOKEN))
 *   payload = { exp }（security.sessionDays 天）。无状态、不落库。
 */

export const SESSION_COOKIE = 'youlin_session'

const enc = new TextEncoder()

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text: string): Uint8Array {
  const s = text.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

/** ADMIN_TOKEN 校验：先 SHA-256 归一等长再做常数时间比较 */
export async function verifyAdminToken(input: string, expected: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(input)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  return timingSafeEqual(new Uint8Array(da), new Uint8Array(db))
}

export async function signSession(secret: string, days: number, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + days * 86_400
  const payload = b64url(enc.encode(JSON.stringify({ exp })))
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return `${payload}.${b64url(sig)}`
}

export async function verifySession(cookie: string, secret: string, now = Date.now()): Promise<boolean> {
  const dot = cookie.indexOf('.')
  if (dot <= 0) return false
  const payload = cookie.slice(0, dot)
  const sig = cookie.slice(dot + 1)
  try {
    const key = await hmacKey(secret)
    const expected = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
    if (!timingSafeEqual(b64urlDecode(sig), new Uint8Array(expected))) return false
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { exp?: number }
    return typeof data.exp === 'number' && data.exp > Math.floor(now / 1000)
  } catch {
    return false
  }
}

export function cookieOptions(c: Context, maxAgeSeconds: number) {
  // 直连看协议；反代终止 TLS 时看 X-Forwarded-Proto（Caddy/Nginx 都会带）
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  return {
    path: '/',
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:' || forwarded === 'https',
    sameSite: 'Lax',
    maxAge: maxAgeSeconds,
  } as const
}

// ── 登录限流（security.loginRateLimit 次/小时，按 IP）──────────────────────
// 记录在 SQLite 的 login_attempts 表：跨进程、跨重启生效，一小时滑动窗口。

export function loginAllowed(db: Db, ip: string, limitPerHour: number, now = Date.now()): boolean {
  return consumeLoginAttempt(db, ip, limitPerHour, now)
}

export function resetLoginHits(db: Db, ip: string): void {
  resetLoginAttempts(db, ip)
}

// ── 中间件 ────────────────────────────────────────────────────────────────

/** /api/admin/* 鉴权（/api/admin/login 放行） */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === '/api/admin/login') return next()
  const token = getCookie(c, SESSION_COOKIE)
  if (!token || !(await verifySession(token, c.env.ADMIN_TOKEN))) {
    return c.json({ error: { code: 'unauthorized', message: '未登录或会话已过期' } }, 401)
  }
  await next()
}
