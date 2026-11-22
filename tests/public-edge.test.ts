import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { app } from '../src/app'
import { env, SELF } from './helpers'
import { SqliteDb } from '../src/server/db'
import { createEnv } from '../src/server/env'
import { applyMigrations } from '../src/server/migrations'

/**
 * api.md 承诺但此前未被测试锁定的边界行为：
 *   limit 回退、空 ?group= 语义、invalid_json、turnstile_unconfigured、
 *   /healthz 503、database_not_migrated。
 */

const loginRes = await SELF.fetch('https://example.com/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: process.env.ADMIN_TOKEN }),
})
if (!loginRes.ok) throw new Error('测试登录失败')
const cookie = loginRes.headers.get('set-cookie')!.split(';')[0]!

async function authed(path: string, body: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body,
  })
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM source_state'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})

async function seedCircleArticles(): Promise<void> {
  const g = await env.DB.prepare('INSERT INTO groups (name) VALUES (?) RETURNING id').bind('圈').first<{ id: number }>()
  const friend = (
    await env.DB.prepare('INSERT INTO friends (group_id, author, link, feed, in_circle, since) VALUES (?, ?, ?, ?, 1, ?) RETURNING id')
      .bind(g!.id, '甲', 'https://jia.example.com/', 'https://jia.example.com/feed.xml', '2026-01-01')
      .first<{ id: number }>()
  )!.id
  const rows = [1, 2, 3].map(
    (n) =>
      env.DB.prepare(
        `INSERT INTO articles (friend_id, guid, title, link, author, published_at, fetched_at) VALUES (?, ?, ?, ?, '甲', ?, datetime('now'))`,
      ).bind(friend, `g${n}`, `甲${n}`, `https://jia.example.com/${n}`, `2026-10-0${n}T10:00:00Z`),
  )
  await env.DB.batch(rows)
}

describe('公开接口边界行为', () => {
  it('limit 非法（0/负数/非数字）回退到 outputMaxArticles 口径', async () => {
    await seedCircleArticles()
    await authed('/api/admin/settings', JSON.stringify({ 'crawl.outputMaxArticles': 2 }))

    const fetchCount = async (query: string): Promise<number> => {
      const res = await SELF.fetch(`https://example.com/api/circle${query}`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { articles: unknown[] }
      return body.articles.length
    }

    expect(await fetchCount('?limit=0')).toBe(2)
    expect(await fetchCount('?limit=-5')).toBe(2)
    expect(await fetchCount('?limit=abc')).toBe(2)
    expect(await fetchCount('?limit=1')).toBe(1)
    expect(await fetchCount('')).toBe(2)
  })

  it('?group=（空串）按空分组名过滤，与不带参数的全量语义不同', async () => {
    await seedCircleArticles()
    const all = await SELF.fetch('https://example.com/api/links')
    const allBody = (await all.json()) as { groups: unknown[] }
    expect(allBody.groups.length).toBe(1)

    const filtered = await SELF.fetch('https://example.com/api/links?group=')
    const filteredBody = (await filtered.json()) as { groups: unknown[] }
    expect(filteredBody.groups).toEqual([])
  })

  it('POST /apply 请求体非 JSON → 400 invalid_json', async () => {
    const res = await SELF.fetch('https://example.com/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-a-json',
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_json')
  })

  it('开启 Turnstile 但服务端缺 TURNSTILE_SECRET → 403 turnstile_unconfigured', async () => {
    await authed('/api/admin/settings', JSON.stringify({ 'apply.turnstile': true }))
    const noSecretEnv = { ...env, TURNSTILE_SECRET: undefined }
    const res = await app.request(
      new Request('https://example.com/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteName: '新站', link: 'https://new.example.com/', turnstileToken: 'tok' }),
      }),
      undefined,
      noSecretEnv,
    )
    const body = (await res.json()) as { error?: { code?: string } }
    expect(res.status, JSON.stringify(body)).toBe(403)
    expect(body.error?.code).toBe('turnstile_unconfigured')
  })
})

describe('健康检查与迁移错误', () => {
  it('/healthz：库正常 200；库关闭后 503 且 ok=false', async () => {
    const raw = new Database(':memory:')
    raw.pragma('foreign_keys = ON')
    applyMigrations(raw, new URL('../migrations', import.meta.url).pathname)
    const localEnv = createEnv(new SqliteDb(raw))

    const ok = await app.request(new Request('https://example.com/healthz'), undefined, localEnv)
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { ok: boolean }).ok).toBe(true)

    raw.close()
    const down = await app.request(new Request('https://example.com/healthz'), undefined, localEnv)
    expect(down.status).toBe(503)
    expect(((await down.json()) as { ok: boolean; db: boolean })).toMatchObject({ ok: false, db: false })
  })

  it('未迁移的库上请求业务接口 → 503 database_not_migrated', async () => {
    const bare = createEnv(new SqliteDb(new Database(':memory:')))
    const res = await app.request(new Request('https://example.com/api/links'), undefined, bare)
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('database_not_migrated')
  })
})
