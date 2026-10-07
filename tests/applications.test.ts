import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'

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

async function loginCookie(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.1.1.1' },
    body: JSON.stringify({ token: 'test-admin-token' }),
  })
  return res.headers.get('set-cookie')!.split(';')[0]!
}

async function authed(path: string, opts: { method?: string; body?: string } = {}): Promise<Response> {
  return SELF.fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: await loginCookie() },
    body: opts.body,
  })
}

async function seedApplication(over: Partial<Record<string, unknown>> = {}): Promise<number> {
  const res = await SELF.fetch(`${BASE}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    body: JSON.stringify({ siteName: '待审站', link: `https://app-${Math.random().toString(36).slice(2, 8)}.example.com/`, ...over }),
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { id: number }).id
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM apply_rate_limit'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
  await setSettings({ 'apply.turnstile': false, 'apply.backlinkPolicy': 'off' })
})
afterEach(() => vi.unstubAllGlobals())

describe('申请队列（管理端）', () => {
  it('列表：默认 pending；可按 status 过滤；未登录 401', async () => {
    await seedApplication({ siteName: 'A' })
    await seedApplication({ siteName: 'B' })

    const list = await authed('/api/admin/applications')
    const body = (await list.json()) as { applications: { siteName: string; status: string; backlink: { ok: boolean | null } }[] }
    expect(body.applications).toHaveLength(2)
    expect(body.applications[0]!.status).toBe('pending')
    expect(body.applications[0]!.backlink.ok).toBeNull() // 策略 off 未检测

    expect((await SELF.fetch(`${BASE}/api/admin/applications`)).status).toBe(401)
    const bad = await authed('/api/admin/applications?status=bogus')
    expect(bad.status).toBe(400)
  })

  it('通过：建友链（可选分组/字段覆盖）→ 申请 approved、接口一可见', async () => {
    const id = await seedApplication({ siteName: '好站点', author: '好人', desc: '简介', feed: 'https://good.example.com/feed.xml' })
    const g = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: '新朋友' }) })
    const { id: gid } = (await g.json()) as { id: number }

    const approve = await authed(`/api/admin/applications/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ groupId: gid, title: '好站点·覆盖标题' }),
    })
    expect(approve.status).toBe(200)
    const { friendId } = (await approve.json()) as { friendId: number }

    const links = (await (await SELF.fetch(`${BASE}/api/links`)).json()) as {
      groups: { name: string; links: { author: string; title?: string }[] }[]
    }
    const grp = links.groups.find((x) => x.name === '新朋友')!
    expect(grp.links).toHaveLength(1)
    expect(grp.links[0]).toMatchObject({ author: '好人', title: '好站点·覆盖标题' })

    const list = await authed('/api/admin/applications?status=approved')
    const body = (await list.json()) as { applications: { id: number; reviewNote?: string }[] }
    expect(body.applications[0]!.id).toBe(id)
    expect(body.applications[0]!.reviewNote).toContain(`#${friendId}`)
  })

  it('通过：重复处理 409；链接已在友链 409', async () => {
    const id = await seedApplication()
    await authed(`/api/admin/applications/${id}/approve`, { method: 'POST', body: '{}' })
    const again = await authed(`/api/admin/applications/${id}/approve`, { method: 'POST', body: '{}' })
    expect(again.status).toBe(409)

    const id2 = await seedApplication({ link: 'https://dup2.example.com/' })
    const g = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: 'g' }) })
    const { id: gid } = (await g.json()) as { id: number }
    await env.DB.prepare('INSERT INTO friends (group_id, author, link, since) VALUES (?, ?, ?, ?)')
      .bind(gid, 'X', 'https://dup2.example.com/', '2026-01-01')
      .run()
    const dup = await authed(`/api/admin/applications/${id2}/approve`, { method: 'POST', body: '{}' })
    expect(dup.status).toBe(409)
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe('duplicate_link')
  })

  it('拒绝：记录原因；再次处理 409', async () => {
    const id = await seedApplication()
    const rej = await authed(`/api/admin/applications/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: '站点内容不符合' }) })
    expect(rej.status).toBe(200)

    const list = await authed('/api/admin/applications?status=rejected')
    const body = (await list.json()) as { applications: { reviewNote?: string }[] }
    expect(body.applications[0]!.reviewNote).toBe('站点内容不符合')

    const again = await authed(`/api/admin/applications/${id}/reject`, { method: 'POST', body: '{}' })
    expect(again.status).toBe(409)
  })
})

describe('重建触发', () => {
  it('未启用 → 400；webhook 模式 → POST 目标地址并记录防抖', async () => {
    const disabled = await authed('/api/admin/rebuild', { method: 'POST', body: '{}' })
    expect(disabled.status).toBe(400)

    const calls: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? '') })
      return new Response('ok', { status: 200 })
    })
    await setSettings({ 'rebuild.enabled': true, 'rebuild.provider': 'webhook', 'rebuild.webhookUrl': 'https://ci.example.com/hook', 'rebuild.debounceSeconds': 60 })

    const res = await authed('/api/admin/rebuild', { method: 'POST', body: JSON.stringify({ reason: 'test' }) })
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://ci.example.com/hook')
    expect(calls[0]!.body).toContain('youlin.data-changed')

    // 防抖：立刻再来一次 → 429
    const debounced = await authed('/api/admin/rebuild', { method: 'POST', body: '{}' })
    expect(debounced.status).toBe(429)
    expect(calls).toHaveLength(1)
  })

  it('github_dispatch 模式：调用 GitHub API（带 PAT 与 event_type）', async () => {
    const calls: { url: string; auth?: string; body: string }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url: String(input), auth: headers.Authorization, body: String(init?.body ?? '') })
      return new Response(null, { status: 204 })
    })
    await setSettings({
      'rebuild.enabled': true,
      'rebuild.provider': 'github_dispatch',
      'rebuild.githubRepo': 'owner/site',
      'rebuild.eventType': 'friends-updated',
      'rebuild.debounceSeconds': 0,
    })

    const res = await authed('/api/admin/rebuild', { method: 'POST', body: '{}' })
    expect(res.status).toBe(200)
    expect(calls[0]!.url).toBe('https://api.github.com/repos/owner/site/dispatches')
    expect(calls[0]!.auth).toBe('Bearer test-github-pat')
    expect(calls[0]!.body).toContain('"event_type":"friends-updated"')
  })

  it('通过申请时 rebuild=true 触发；rebuild.auto 时保存友链也触发', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response('ok', { status: 200 })
    })
    await setSettings({
      'rebuild.enabled': true,
      'rebuild.provider': 'webhook',
      'rebuild.webhookUrl': 'https://ci.example.com/hook',
      'rebuild.debounceSeconds': 0,
      'rebuild.auto': true,
    })

    const id = await seedApplication()
    await authed(`/api/admin/applications/${id}/approve`, { method: 'POST', body: JSON.stringify({ rebuild: true }) })
    expect(calls.some((u) => u === 'https://ci.example.com/hook')).toBe(true)

    // rebuild.auto：保存友链触发（waitUntil 任务在测试环境同样执行）
    calls.length = 0
    const g = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: 'g2' }) })
    const { id: gid } = (await g.json()) as { id: number }
    await authed('/api/admin/friends', {
      method: 'POST',
      body: JSON.stringify({ groupId: gid, author: 'Auto', title: '自动站', link: 'https://auto-friend.example.com/', since: '2026-01-01' }),
    })
    await new Promise((r) => setTimeout(r, 50)) // 等 waitUntil 完成
    expect(calls).toContain('https://ci.example.com/hook')
  })
})
