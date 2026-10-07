import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'

const BASE = 'https://example.com'

async function loginCookie(ip = '10.4.4.1'): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
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

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM source_state'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})

describe('GET /api/admin/stats（总览数据源）', () => {
  it('未登录 401', async () => {
    expect((await SELF.fetch(`${BASE}/api/admin/stats`)).status).toBe(401)
  })

  it('空库全零', async () => {
    const res = await authed('/api/admin/stats')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      friends: { active: 0, hidden: 0, unreachable: 0 },
      circle: { sources: 0, due: 0 },
      articles: { total: 0, lastArticleAt: null },
      applications: { pending: 0, total: 0 },
    })
  })

  it('各计数与最近入库时间正确', async () => {
    const g = await env.DB.prepare('INSERT INTO groups (name) VALUES (?) RETURNING id').bind('s').first<{ id: number }>()
    const f1 = (await env.DB.prepare("INSERT INTO friends (group_id, author, link, feed, since, status) VALUES (?, '甲', 'https://1.example.com/', 'https://1.example.com/feed.xml', '2026-01-01', 'active') RETURNING id").bind(g!.id).first<{ id: number }>())!.id
    const f2 = (await env.DB.prepare("INSERT INTO friends (group_id, author, link, feed, since, status) VALUES (?, '乙', 'https://2.example.com/', 'https://2.example.com/feed.xml', '2026-01-01', 'hidden') RETURNING id").bind(g!.id).first<{ id: number }>())!.id
    await env.DB.prepare("INSERT INTO friends (group_id, author, link, since) VALUES (?, '丙', 'https://3.example.com/', '2026-01-01')").bind(g!.id).run()
    await env.DB.batch([
      env.DB.prepare("INSERT INTO articles (friend_id, guid, title, link, published_at, fetched_at) VALUES (?, 'g1', 'A', 'https://1.example.com/a', '2026-10-01T00:00:00Z', '2026-10-05T08:00:00')").bind(f1),
      env.DB.prepare("INSERT INTO articles (friend_id, guid, title, link, published_at, fetched_at) VALUES (?, 'g2', 'B', 'https://1.example.com/b', '2026-10-02T00:00:00Z', '2026-10-06T09:00:00')").bind(f2),
      env.DB.prepare("INSERT INTO source_state (friend_id, reachable, checked_at) VALUES (?, 0, datetime('now'))").bind(f1),
      env.DB.prepare("INSERT INTO applications (site_name, link, status) VALUES ('待审', 'https://app.example.com/', 'pending')"),
      env.DB.prepare("INSERT INTO applications (site_name, link, status) VALUES ('已拒', 'https://rej.example.com/', 'rejected')"),
    ])

    const res = await authed('/api/admin/stats')
    await expect(res.json()).resolves.toEqual({
      friends: { active: 2, hidden: 1, unreachable: 1 },
      circle: { sources: 1, due: 2 }, // 有 feed 的 active 源 1（甲）；乙 hidden 不计入 due，丙无 feed 无状态 → due
      articles: { total: 2, lastArticleAt: '2026-10-06T09:00:00Z' },
      applications: { pending: 1, total: 2 },
    })
  })
})
