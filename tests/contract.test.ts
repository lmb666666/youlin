import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'
import Ajv2020 from 'ajv/dist/2020'
import schema from '../schemas/api-links.response.schema.json'
import example from '../schemas/examples/api-links.example.json'

const ajv = new Ajv2020({ strict: false, allErrors: true })
const validate = ajv.compile(schema as object)

async function login(): Promise<string> {
  const res = await SELF.fetch('https://example.com/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.9.0.1' },
    body: JSON.stringify({ token: 'test-admin-token' }),
  })
  expect(res.status).toBe(200)
  const cookie = res.headers.get('set-cookie')!
  return cookie.split(';')[0]!
}

async function createGroup(name: string, desc?: string): Promise<number> {
  const res = await SELF.fetch('https://example.com/api/admin/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: await login() },
    body: JSON.stringify({ name, desc }),
  })
  expect(res.status).toBe(201)
  const { id } = (await res.json()) as { id: number }
  return id
}

async function createFriend(groupId: number, body: Record<string, unknown>): Promise<number> {
  const res = await SELF.fetch('https://example.com/api/admin/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: await login() },
    body: JSON.stringify({ groupId, ...body }),
  })
  expect(res.status).toBe(201)
  const { id } = (await res.json()) as { id: number }
  return id
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})

describe('接口一 GET /api/links 契约', () => {
  it('空库返回 { groups: [] } 且通过 schema', async () => {
    const res = await SELF.fetch('https://example.com/api/links')
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown
    expect(validate(body)).toBe(true)
    expect((body as { groups: unknown[] }).groups).toEqual([])
  })

  it('完整数据通过 schema；可选字段按需输出；headers 正确', async () => {
    const gid = await createGroup('朋友们', '在这里添加你关注的博客。')
    await createFriend(gid, {
      author: 'Liang',
      title: 'Liang 的博客',
      desc: '一位数码科技爱好者',
      link: 'https://blog.liang.one/',
      feed: 'https://blog.liang.one/atom.xml',
      icon: 'https://blog.liang.one/favicon.ico',
      avatar: 'https://bu.dusays.com/2026/07/12/6a532cc8ab04a.webp',
      archs: ['Nuxt'],
      since: '2024-08-25',
      comment: '好友，数码科技方向',
    })
    await createFriend(gid, { author: 'Aki', title: 'Aki 的小站', link: 'https://aki.example.com/', since: '2025-01-02' })

    // 体检摘要：直接写 source_state
    await env.DB.prepare(
      `INSERT INTO source_state (friend_id, reachable, crawlable, backlink_checked, backlink, latency_ms,
                                 last_post_published, last_post_days_ago, unreachable_since, checked_at)
       VALUES ((SELECT id FROM friends WHERE link = ?), 1, 1, 1, 1, 840,
               '2026-09-25 12:04:00', 10, NULL, '2026-10-05 13:55:00')`,
    )
      .bind('https://blog.liang.one/')
      .run()

    const res = await SELF.fetch('https://example.com/api/links')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')

    const body = (await res.json()) as {
      groups: { name: string; desc?: string; links: Record<string, unknown>[] }[]
    }
    expect(validate(body)).toBe(true)

    expect(body.groups).toHaveLength(1)
    const g = body.groups[0]!
    expect(g.name).toBe('朋友们')
    expect(g.desc).toBe('在这里添加你关注的博客。')
    expect(g.links).toHaveLength(2)

    const full = g.links[0]!
    expect(full.author).toBe('Liang')
    expect(full.link).toBe('https://blog.liang.one/')
    expect(full.since).toBe('2024-08-25')
    expect(full.archs).toEqual(['Nuxt'])
    const health = full.health as Record<string, unknown>
    expect(health).toBeTruthy()
    expect(health.reachable).toBe(true)
    expect(health.crawlable).toBe(true)
    expect(health.backlink).toBe(true)
    expect(health.latency).toBe(0.84)
    expect(health.lastPostAt).toBe('2026-09-25T12:04:00Z') // ISO 8601 UTC
    expect(health.staleDays).toBe(10)
    expect(health.unreachableDays).toBeNull()
    expect(health.checkedAt).toBe('2026-10-05T13:55:00Z')

    // 可选字段无值不输出（title 现为必填，始终存在；feed/health 等仍按需输出）
    const minimal = g.links[1]!
    expect(minimal.author).toBe('Aki')
    expect(minimal.title).toBe('Aki 的小站')
    expect('feed' in minimal).toBe(false)
    expect('health' in minimal).toBe(false)
  })

  it('?group= 过滤精确匹配；未命中返回空数组', async () => {
    await createGroup('技术区')
    const gid = await createGroup('生活区')
    await createFriend(gid, { author: 'Bo', title: 'Bo 的站', link: 'https://bo.example.com/', since: '2026-01-01' })

    const hit = await SELF.fetch('https://example.com/api/links?group=' + encodeURIComponent('生活区'))
    const hitBody = (await hit.json()) as { groups: { name: string; links: unknown[] }[] }
    expect(validate(hitBody)).toBe(true)
    expect(hitBody.groups).toHaveLength(1)
    expect(hitBody.groups[0]!.name).toBe('生活区')
    expect(hitBody.groups[0]!.links).toHaveLength(1)

    const miss = await SELF.fetch('https://example.com/api/links?group=不存在')
    const missBody = (await miss.json()) as { groups: unknown[] }
    expect(validate(missBody)).toBe(true)
    expect(missBody.groups).toEqual([])
  })

  it('hidden 友链默认不输出；api.includeHidden=true 时输出', async () => {
    const gid = await createGroup('隐藏测试')
    await createFriend(gid, { author: 'Hide', title: '隐藏站', link: 'https://hide.example.com/', since: '2026-02-02', status: 'hidden' })
    const res = await SELF.fetch('https://example.com/api/links')
    const body = (await res.json()) as { groups: { links: unknown[] }[] }
    expect(validate(body)).toBe(true)
    expect(body.groups[0]!.links).toEqual([])

    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
      .bind('api.includeHidden', 'true')
      .run()
    const res2 = await SELF.fetch('https://example.com/api/links')
    const body2 = (await res2.json()) as { groups: { links: { author: string }[] }[] }
    expect(validate(body2)).toBe(true)
    expect(body2.groups[0]!.links.map((l) => l.author)).toContain('Hide')
  })

  it('契约示例文件本身通过 schema', () => {
    expect(validate(example)).toBe(true)
  })
})

describe('健康检查 GET /healthz', () => {
  it('D1 可达时返回 200，且禁用缓存', async () => {
    const res = await SELF.fetch('https://example.com/healthz')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, db: true })
  })
})
