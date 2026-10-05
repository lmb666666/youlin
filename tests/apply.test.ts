import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SELF } from 'cloudflare:test'
import Ajv2020 from 'ajv/dist/2020'
import { env } from './helpers'
import schema from '../schemas/api-apply.response.schema.json'
import example from '../schemas/examples/api-apply.example.json'

const ajv = new Ajv2020({ strict: false, allErrors: true })
const validate = ajv.compile(schema as object)

const BASE = 'https://example.com'

async function setSettings(pairs: Record<string, unknown>): Promise<void> {
  await env.DB.batch(
    Object.entries(pairs).map(([k, v]) =>
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(
        k,
        JSON.stringify(v),
      ),
    ),
  )
}

function post(body: unknown, ip = '10.9.9.9'): Promise<Response> {
  return SELF.fetch(`${BASE}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  })
}

const VALID = { siteName: '新朋友', link: 'https://newfriend.example.com/', desc: '你好' }

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM apply_rate_limit'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
  // 默认：关 Turnstile / 反链 mark，聚焦基础链路
  await setSettings({ 'apply.turnstile': false, 'apply.backlinkPolicy': 'mark' })
})
afterEach(() => vi.unstubAllGlobals())

describe('接口三 GET /apply（申请页）', () => {
  it('渲染页面：站点名、表单字段、必填标记、no-store', async () => {
    await setSettings({ 'site.name': '梁的博客', 'apply.intro': '欢迎交换友链！' })
    const res = await SELF.fetch(`${BASE}/apply`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const html = await res.text()
    expect(html).toContain('梁的博客')
    expect(html).toContain('欢迎交换友链！')
    expect(html).toContain('name="siteName"')
    expect(html).toContain('name="link"')
    expect(html).toContain('id="apply-form"')
    // 必填（默认 siteName/link）带 required
    expect(/name="siteName"[^>]*required/.test(html)).toBe(true)
    expect(/name="link"[^>]*required/.test(html)).toBe(true)
    expect(/name="author"[^>]*required/.test(html)).toBe(false)
  })

  it('apply.enabled=0 → 显示停用提示，不渲染表单', async () => {
    await setSettings({ 'apply.enabled': false })
    const html = await (await SELF.fetch(`${BASE}/apply`)).text()
    expect(html).toContain('未开放')
    expect(html).not.toContain('id="apply-form"')
  })

  it('Turnstile 开启且配置 siteKey → 渲染挂件与脚本', async () => {
    await setSettings({ 'apply.turnstile': true, 'apply.turnstileSiteKey': '1x00000000000000000000AA' })
    const html = await (await SELF.fetch(`${BASE}/apply`)).text()
    expect(html).toContain('cf-turnstile')
    expect(html).toContain('challenges.cloudflare.com/turnstile/v0/api.js')
  })

  it('POST 预检（OPTIONS）返回 CORS 头', async () => {
    const res = await SELF.fetch(`${BASE}/apply`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type')
  })
})

describe('接口三 POST /apply（提交）', () => {
  it('成功提交 → 201 过 schema；落库 pending；反链结果随响应返回', async () => {
    await setSettings({ 'site.url': 'https://me.example.com', 'backlink.enabled': true })
    vi.stubGlobal('fetch', async () =>
      new Response('<html><a href="https://me.example.com/">友链</a></html>', { status: 200 }),
    )
    const res = await post(VALID)
    expect(res.status).toBe(201)
    const body = (await res.json()) as unknown
    expect(validate(body)).toBe(true)
    expect(body).toMatchObject({ status: 'pending', backlink: { ok: true } })
    expect((body as { backlink: { detail: string } }).backlink.detail).toContain('me.example.com')

    const row = await env.DB.prepare('SELECT site_name, status, backlink_ok, backlink_detail FROM applications').first<{
      site_name: string
      status: string
      backlink_ok: number
      backlink_detail: string
    }>()
    expect(row).toMatchObject({ site_name: '新朋友', status: 'pending', backlink_ok: 1 })
  })

  it('契约示例文件本身通过 schema', () => {
    expect(validate(example)).toBe(true)
  })

  it('字段校验：缺必填 → 400 字段级 message', async () => {
    const res = await post({ link: 'https://x.example.com/' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; details: Record<string, string> } }
    expect(body.error.code).toBe('validation_failed')
    expect(body.error.details.siteName).toBeTruthy()

    const badUrl = await post({ siteName: 'X', link: 'notaurl' })
    expect(badUrl.status).toBe(400)
    expect(((await badUrl.json()) as { error: { details: Record<string, string> } }).error.details.link).toBeTruthy()
  })

  it('apply.enabled=0 → 403 apply_disabled', async () => {
    await setSettings({ 'apply.enabled': false })
    const res = await post(VALID)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('apply_disabled')
  })

  it('重复：已在友链 → 409 duplicate_link；已有待审 → 409 already_pending', async () => {
    const g = await env.DB.prepare('INSERT INTO groups (name) VALUES (?) RETURNING id').bind('g').first<{ id: number }>()
    await env.DB.prepare('INSERT INTO friends (group_id, author, link, since) VALUES (?, ?, ?, ?)')
      .bind(g!.id, 'Old', 'https://old.example.com/', '2026-01-01')
      .run()

    const dup = await post({ siteName: 'Old', link: 'https://old.example.com/' }, '10.9.9.10')
    expect(dup.status).toBe(409)
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe('duplicate_link')

    // 尾斜杠等价也应命中
    const dupSlash = await post({ siteName: 'Old', link: 'https://old.example.com' }, '10.9.9.11')
    expect(dupSlash.status).toBe(409)

    const first = await post({ siteName: 'New', link: 'https://pending.example.com/' }, '10.9.9.12')
    expect(first.status).toBe(201)
    const again = await post({ siteName: 'New', link: 'https://pending.example.com/' }, '10.9.9.13')
    expect(again.status).toBe(409)
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('already_pending')
  })

  it('限流：每 IP 每天 N 次（成功才计数），换 IP 不受影响', async () => {
    await setSettings({ 'apply.rateLimitPerDay': 2 })
    const ip = '10.8.8.8'
    for (let i = 0; i < 2; i++) {
      const r = await post({ siteName: `S${i}`, link: `https://s${i}.example.com/` }, ip)
      expect(r.status).toBe(201)
    }
    const blocked = await post({ siteName: 'S3', link: 'https://s3.example.com/' }, ip)
    expect(blocked.status).toBe(429)
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('rate_limited')

    const other = await post({ siteName: 'S4', link: 'https://s4.example.com/' }, '10.8.8.9')
    expect(other.status).toBe(201)
  })

  it('Turnstile：开关关闭时无需 token；开启时缺 token 400 / 验证失败 403 / 通过 201', async () => {
    // 关闭（默认 setSettings）→ 直接 201 已由前例覆盖；这里验证开启后的三态
    await setSettings({ 'apply.turnstile': true })

    const missing = await post(VALID, '10.7.7.1')
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error: { details: Record<string, string> } }).error.details.turnstileToken).toBeTruthy()

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('siteverify')) {
        return Response.json({ success: false, 'error-codes': ['invalid-input-response'] })
      }
      return new Response('ok', { status: 200 })
    })
    const failed = await post({ ...VALID, turnstileToken: 'bad-token' }, '10.7.7.2')
    expect(failed.status).toBe(403)
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe('turnstile_failed')

    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('siteverify')) return Response.json({ success: true })
      return new Response('ok', { status: 200 })
    })
    const okRes = await post({ ...VALID, turnstileToken: 'good-token' }, '10.7.7.3')
    expect(okRes.status).toBe(201)
  })

  it('backlinkPolicy=reject 且未检测到反链 → 403 backlink_missing；检测到 → 201', async () => {
    await setSettings({ 'apply.backlinkPolicy': 'reject', 'site.url': 'https://me.example.com', 'backlink.enabled': true })
    vi.stubGlobal('fetch', async () => new Response('<html>没有链接</html>', { status: 200 }))
    const rejected = await post({ siteName: 'A', link: 'https://a.example.com/' }, '10.6.6.1')
    expect(rejected.status).toBe(403)
    expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe('backlink_missing')

    vi.stubGlobal('fetch', async () => new Response('<a href="//me.example.com/x">友链</a>', { status: 200 }))
    const okRes = await post({ siteName: 'B', link: 'https://b.example.com/' }, '10.6.6.2')
    expect(okRes.status).toBe(201)
  })

  it('autoApprove → 直接入库：状态 approved、友链出现在接口一', async () => {
    await setSettings({ 'apply.autoApprove': true })
    const res = await post({ siteName: '自动站', author: '阿自', link: 'https://auto.example.com/', feed: 'https://auto.example.com/feed.xml' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { status: string }
    expect(validate(body)).toBe(true)
    expect(body.status).toBe('approved')

    const links = (await (await SELF.fetch(`${BASE}/api/links`)).json()) as { groups: { name: string; links: { author: string; link: string }[] }[] }
    const all = links.groups.flatMap((g) => g.links)
    expect(all.find((l) => l.link === 'https://auto.example.com/')).toBeTruthy()
  })
})
