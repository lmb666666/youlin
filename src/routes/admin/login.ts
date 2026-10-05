import { Hono } from 'hono'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { SESSION_COOKIE, cookieOptions, verifyAdminToken, loginAllowed, resetLoginHits, signSession } from '../../auth'
import { jsonError } from '../../util/http'
import type { AppEnv } from '../../types'

export function loginRoutes() {
  const app = new Hono<AppEnv>()

  app.post('/api/admin/login', async (c) => {
    const cfg = c.get('cfg')
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local'
    if (!loginAllowed(ip, cfg.security.loginRateLimit)) {
      return jsonError(429, 'rate_limited', '尝试过于频繁，请一小时后再试')
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return jsonError(400, 'invalid_json', '请求体须为 JSON')
    }
    const token = (body as { token?: unknown })?.token
    if (typeof token !== 'string' || token.length === 0) {
      return jsonError(400, 'invalid_body', '缺少 token')
    }
    if (!(await verifyAdminToken(token, c.env.ADMIN_TOKEN))) {
      return jsonError(401, 'bad_token', '口令不正确')
    }

    resetLoginHits(ip)
    const days = cfg.security.sessionDays
    const session = await signSession(c.env.ADMIN_TOKEN, days)
    setCookie(c, SESSION_COOKIE, session, cookieOptions(c, days * 86_400))
    return c.json({ ok: true })
  })

  app.post('/api/admin/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.json({ ok: true })
  })

  app.get('/api/admin/me', (c) => {
    // requireAdmin 已保证会话有效
    const session = getCookie(c, SESSION_COOKIE) ?? ''
    void session
    return c.json({ ok: true })
  })

  return app
}
