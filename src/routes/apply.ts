import { Hono } from 'hono'
import { readJsonLimited } from '../util/http'
import { clientIp } from '../util/ip'
import { renderApplyPage } from '../apply-page'
import { submitApplication } from '../services/apply'
import type { AppEnv } from '../types'

/**
 * 友链申请接口（DESIGN §4.3）
 *   GET  /apply   内置申请页（HTML，文案由 site.* / apply.* 驱动）
 *   POST /apply   JSON 提交：400 字段校验 / 403 人机验证或反链拒绝 / 409 重复 / 429 限流
 * 成功 201：{ id, status, backlink: { ok, detail } }
 */

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
    const limited = await readJsonLimited(c, 64 * 1024)
    if (!limited.ok) return limited.response

    const result = await submitApplication(c.env.DB, c.env, c.get('cfg'), clientIp(c), limited.value)
    return c.json(result, 201)
  })

  return app
}
