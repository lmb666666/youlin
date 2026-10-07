import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'

const BASE = 'https://example.com'

async function authed(path: string, opts: { method?: string; body?: string } = {}): Promise<Response> {
  const login = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.4.5.1' },
    body: JSON.stringify({ token: 'test-admin-token' }),
  })
  return SELF.fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie')!.split(';')[0]! },
    body: opts.body,
  })
}

async function seedFriend(link: string, feed: string | null): Promise<number> {
  const g = await env.DB.prepare('INSERT INTO groups (name) VALUES (?) RETURNING id').bind('p').first<{ id: number }>()
  return (
    await env.DB.prepare('INSERT INTO friends (group_id, author, link, feed, since) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(g!.id, 'P', link, feed, '2026-01-01')
      .first<{ id: number }>()
  )!.id
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/admin/friends/probe（表单预保存探测）', () => {
  it('未登录 401；缺链接 400', async () => {
    expect((await SELF.fetch(`${BASE}/api/admin/friends/probe`, { method: 'POST', body: '{}' })).status).toBe(401)
    const bad = await authed('/api/admin/friends/probe', { method: 'POST', body: JSON.stringify({ link: 'notaurl' }) })
    expect(bad.status).toBe(400)
  })

  it('从声明式 <link> 发现 feed + 站点标题', async () => {
    const feedXml = '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><item><title>A</title><link>https://p.example.com/a</link><pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>'
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://p.example.com/') {
        return new Response('<html><head><title>探针站</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>', { status: 200 })
      }
      if (url === 'https://p.example.com/feed.xml') return new Response(feedXml, { status: 200 })
      if (url === 'https://p.example.com/favicon.ico') return new Response('ico', { status: 200 })
      return new Response('nf', { status: 404 })
    })
    const res = await authed('/api/admin/friends/probe', {
      method: 'POST',
      body: JSON.stringify({ link: 'https://p.example.com/' }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      probe: { feed: 'https://p.example.com/feed.xml', title: '探针站', icon: 'https://p.example.com/favicon.ico' },
    })
  })

  it('站点不可达 → 502 probe_unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('dns fail')
    })
    const res = await authed('/api/admin/friends/probe', {
      method: 'POST',
      body: JSON.stringify({ link: 'https://dead.example.com/' }),
    })
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('probe_unreachable')
  })
})

describe('POST /api/admin/friends/:id/probe（已保存友链探测）', () => {
  it('已有可用 feed 时不重复发现；404 友链 → 404', async () => {
    const fid = await seedFriend('https://q.example.com/', 'https://q.example.com/feed.xml')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://q.example.com/') {
        return new Response('<html><head><title>Q 站</title><link rel="alternate" type="application/rss+xml" href="/other.xml"></head></html>', { status: 200 })
      }
      if (url === 'https://q.example.com/feed.xml') {
        return new Response('<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>', { status: 200 })
      }
      return new Response('nf', { status: 404 })
    })
    const res = await authed(`/api/admin/friends/${fid}/probe`, { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { probe: { feed?: string; title?: string } }
    expect(body.probe.feed).toBeUndefined() // 已配置且可用 → 不重复发现
    expect(body.probe.title).toBe('Q 站')

    const missing = await authed('/api/admin/friends/99999/probe', { method: 'POST' })
    expect(missing.status).toBe(404)
  })
})
