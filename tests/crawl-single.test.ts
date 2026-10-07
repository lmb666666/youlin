import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'

const BASE = 'https://example.com'

function rssXml(items: { title: string; link: string; pubDate: string; guid?: string }[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.guid ? `<guid>${i.guid}</guid>` : ''}<pubDate>${i.pubDate}</pubDate></item>`)
    .join('')}</channel></rss>`
}

async function authed(path: string, opts: { method?: string; body?: string } = {}): Promise<Response> {
  const login = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.4.6.1' },
    body: JSON.stringify({ token: 'test-admin-token' }),
  })
  return SELF.fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie')!.split(';')[0]! },
    body: opts.body,
  })
}

async function seedFriend(feed: string | null): Promise<{ id: number; base: string; feedUrl: string | null }> {
  const base = `https://cs-${Math.random().toString(36).slice(2, 8)}.example.com/`
  const g = await env.DB.prepare('INSERT INTO groups (name) VALUES (?) RETURNING id').bind('cs').first<{ id: number }>()
  const feedUrl = feed === null ? null : `${base}feed.xml`
  const f = await env.DB.prepare('INSERT INTO friends (group_id, author, link, feed, in_circle, since) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(g!.id, 'T', base, feedUrl, 1, '2026-01-01')
    .first<{ id: number }>()
  return { id: f!.id, base, feedUrl }
}

const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toUTCString()

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM source_state'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})
afterEach(() => vi.unstubAllGlobals())

describe('POST /api/admin/crawl/:friendId（单源手动抓取）', () => {
  it('未登录 401；不存在的友链 404', async () => {
    expect((await SELF.fetch(`${BASE}/api/admin/crawl/1`, { method: 'POST' })).status).toBe(401)
    expect((await authed('/api/admin/crawl/99999', { method: 'POST' })).status).toBe(404)
  })

  it('抓取成功 → ok、文章入库、状态更新', async () => {
    const { id, base } = await seedFriend('feed')
    vi.stubGlobal('fetch', async () =>
      new Response(
        rssXml([{ title: 'P1', link: `${base}p1`, pubDate: D(1), guid: 'p1' }]),
        { status: 200, headers: { ETag: '"v1"' } },
      ),
    )
    const res = await authed(`/api/admin/crawl/${id}`, { method: 'POST' })
    await expect(res.json()).resolves.toEqual({ outcome: 'ok' })
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE friend_id = ?').bind(id).first<{ n: number }>()
    expect(n?.n).toBe(1)
  })

  it('再次抓取带 If-None-Match → 304 notModified', async () => {
    const { id, base } = await seedFriend('feed')
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push(headers['If-None-Match'] ?? '')
      if (calls.length === 1) {
        return new Response(rssXml([{ title: 'A', link: `${base}a`, pubDate: D(1), guid: 'a' }]), {
          status: 200,
          headers: { ETag: '"etag-1"' },
        })
      }
      return new Response(null, { status: 304, headers: { ETag: '"etag-1"' } })
    })
    await authed(`/api/admin/crawl/${id}`, { method: 'POST' })
    const res = await authed(`/api/admin/crawl/${id}`, { method: 'POST' })
    await expect(res.json()).resolves.toEqual({ outcome: 'notModified' })
    expect(calls[1]).toBe('"etag-1"')
  })

  it('抓取失败 → failed', async () => {
    const { id } = await seedFriend('feed')
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })
    const res = await authed(`/api/admin/crawl/${id}`, { method: 'POST' })
    await expect(res.json()).resolves.toEqual({ outcome: 'failed' })
  })
})
