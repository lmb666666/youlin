import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'
import { gzipBytes, gunzipBytes } from '../src/backup/codec'
import { CONFIG_FIELDS } from '../src/config/definition'
import type { BackupEnvelope } from '../src/backup/format'

const BASE = 'https://example.com'

async function login(ip = '10.8.8.8'): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ token: 'test-admin-token' }),
  })
  expect(res.status).toBe(200)
  return res.headers.get('set-cookie')!.split(';')[0]!
}

async function authed(
  path: string,
  opts: { method?: string; body?: BodyInit; headers?: Record<string, string>; ip?: string } = {},
): Promise<Response> {
  const cookie = await login(opts.ip)
  return SELF.fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { Cookie: cookie, ...(opts.headers ?? {}) },
    body: opts.body,
  })
}

async function exportBackup(query = ''): Promise<{ gz: Uint8Array; json: BackupEnvelope }> {
  const res = await authed(`/api/admin/backup/export${query}`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('gzip')
  const gz = new Uint8Array(await res.arrayBuffer())
  const json = JSON.parse(new TextDecoder().decode(await gunzipBytes(gz))) as BackupEnvelope
  return { gz, json }
}

function postBackup(path: string, body: Uint8Array | string) {
  return authed(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: typeof body === 'string' ? body : (body as unknown as BodyInit),
  })
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM source_state'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})

async function seed(): Promise<void> {
  // 分组 + 友链（走管理接口，覆盖空作者兜底等真实路径）
  const g = await authed('/api/admin/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '技术区', desc: '技术博客' }),
  })
  const gid = ((await g.json()) as { id: number }).id
  await authed('/api/admin/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId: gid, title: '博客甲', author: '', link: 'https://a.example.com/',
      feed: 'https://a.example.com/atom.xml', since: '2024-01-01', comment: '互访',
    }),
  })
  await authed('/api/admin/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId: gid, title: '博客乙', author: '乙', link: 'https://b.example.com/',
      since: '2024-02-02', status: 'hidden', inCircle: false,
    }),
  })
  // 申请 + 文章 + 体检状态（走 SQL，模拟既有实例的数据）
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO applications (site_name, author, link, status, note, created_at)
       VALUES ('申请站', '申请人', 'https://apply.example.com/', 'pending', '想加友链', '2026-01-02 03:04:05')`,
    ),
    env.DB.prepare(
      `INSERT INTO articles (friend_id, guid, title, link, author, published_at)
       SELECT id, 'guid-1', '文章一', 'https://a.example.com/p/1', '甲', '2026-03-04 05:06:07' FROM friends WHERE link = 'https://a.example.com/'`,
    ),
    env.DB.prepare(
      `INSERT INTO source_state (friend_id, reachable, crawlable, latency_ms, backlink_checked, backlink, fail_count, checked_at)
       SELECT id, 1, 1, 321, 1, 0, 0, '2026-03-05 06:07:08' FROM friends WHERE link = 'https://a.example.com/'`,
    ),
  ])
  // 改一项配置，验证设置随备份往返
  await authed('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'ui.pageSize': 5, 'site.name': '备份测试站' }),
  })
}

describe('备份导出', () => {
  it('生成版本化信封，设置不含 internal.* 运行时键', async () => {
    await seed()
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .bind('internal.round', JSON.stringify({ kind: 'crawl', done: 1 }))
      .run()

    const { json } = await exportBackup()
    expect(json.format).toBe('youlin.backup')
    expect(json.version).toBe(1)
    expect(json.exportedAt).toMatch(/Z$/)
    expect(json.counts!).toMatchObject({ groups: 1, friends: 2, applications: 1, articles: 0 })
    expect(json.data.groups[0]).toMatchObject({ name: '技术区', desc: '技术博客' })

    const friend = json.data.friends.find((f: { link: string }) => f.link === 'https://a.example.com/')
    // 空作者已由后端兜底为站点名
    expect(friend!).toMatchObject({ group: '技术区', author: '博客甲', inCircle: true, status: 'active', comment: '互访' })
    expect(friend!.createdAt).toBeTruthy()
    const hidden = json.data.friends.find((f: { link: string }) => f.link === 'https://b.example.com/')
    expect(hidden!).toMatchObject({ status: 'hidden', inCircle: false })

    expect(json.data.applications[0]).toMatchObject({ siteName: '申请站', status: 'pending', note: '想加友链' })
    expect(json.data.settings['ui.pageSize']).toBe(5)
    expect(json.data.settings['site.name']).toBe('备份测试站')
    expect(json.data.settings['internal.round']).toBeUndefined()
    // 默认不含派生数据
    expect(json.data.articles).toBeUndefined()
    expect(json.data.sourceState).toBeUndefined()
  })

  it('articles=1 时带上文章与体检状态', async () => {
    await seed()
    const { json } = await exportBackup('?articles=1')
    expect(json.counts!.articles).toBe(1)
    expect(json.data.articles![0]).toMatchObject({
      friend: 'https://a.example.com/', guid: 'guid-1', title: '文章一',
      publishedAt: '2026-03-04T05:06:07Z',
    })
    expect(json.data.sourceState![0]).toMatchObject({
      friend: 'https://a.example.com/', reachable: true, crawlable: true, latencyMs: 321,
      backlinkChecked: true, backlink: false,
    })
  })
})

describe('备份恢复', () => {
  it('往返一致：自然键映射、分组归属、隐藏状态、申请与设置', async () => {
    await seed()
    const { gz } = await exportBackup('?articles=1')

    // 模拟另一个实例：清空后先塞一条无关数据，让自增 id 不是从 1 开始
    await env.DB.batch([
      env.DB.prepare('DELETE FROM articles'),
      env.DB.prepare('DELETE FROM source_state'),
      env.DB.prepare('DELETE FROM applications'),
      env.DB.prepare('DELETE FROM friends'),
      env.DB.prepare('DELETE FROM groups'),
      env.DB.prepare("INSERT INTO groups (name, sort) VALUES ('占位分组', 0)"),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('ui.pageSize', '30') ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
    ])

    const res = await postBackup('/api/admin/backup/restore?confirm=1&downloaded=1', gz)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; summary: Record<string, number> }
    expect(body.ok).toBe(true)
    // 设置项导出的是合并默认值后的完整生效配置，因此条数等于配置字段总数
    expect(body.summary).toMatchObject({
      groups: 1, friends: 2, applications: 1, articles: 1, sourceState: 1, settings: CONFIG_FIELDS.length,
    })

    // 公开接口：分组、顺序、隐藏过滤都回来了
    const pub = await (await SELF.fetch(`${BASE}/api/links`)).json() as {
      groups: { name: string; desc?: string; links: { author: string; link: string; comment?: string }[] }[]
    }
    expect(pub.groups.map((g) => g.name)).toEqual(['技术区'])
    expect(pub.groups[0]!.desc).toBe('技术博客')
    expect(pub.groups[0]!.links.map((l) => l.link)).toEqual(['https://a.example.com/'])
    expect(pub.groups[0]!.links[0]!.comment).toBe('互访')

    const admin = await (await authed('/api/admin/friends')).json() as {
      friends: { link: string; status: string; groupName: string; sort: number }[]
    }
    expect(admin.friends.map((f) => `${f.link}:${f.status}:${f.groupName}`)).toEqual([
      'https://a.example.com/:active:技术区',
      'https://b.example.com/:hidden:技术区',
    ])

    const articles = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles').first<{ n: number }>()
    expect(articles!.n).toBe(1)
    const state = await env.DB.prepare('SELECT latency_ms, backlink FROM source_state').first<{ latency_ms: number; backlink: number }>()
    expect(state).toMatchObject({ latency_ms: 321, backlink: 0 })

    const settings = await (await authed('/api/admin/settings')).json() as { values: Record<string, unknown> }
    expect(settings.values['ui.pageSize']).toBe(5)
    expect(settings.values['site.name']).toBe('备份测试站')
  })

  it('保留 internal.* 运行时键，不被恢复清掉', async () => {
    await seed()
    const { gz } = await exportBackup()
    await env.DB.prepare('DELETE FROM friends').run()
    await env.DB.prepare('DELETE FROM groups').run()
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind('internal.keep', JSON.stringify({ at: '2026-01-01' }))
      .run()

    const res = await postBackup('/api/admin/backup/restore?confirm=1&downloaded=1', gz)
    expect(res.status).toBe(200)
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'internal.keep'").first<{ value: string }>()
    expect(row?.value).toContain('2026-01-01')
  })

  it('已存在数据被覆盖：旧友链不残留', async () => {
    await seed()
    const { gz } = await exportBackup()
    await authed('/api/admin/friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: ((await (await authed('/api/admin/groups')).json()) as { groups: { id: number }[] }).groups[0]!.id,
        title: '多余站', link: 'https://extra.example.com/', since: '2024-01-01',
      }),
    })

    const res = await postBackup('/api/admin/backup/restore?confirm=1&downloaded=1', gz)
    expect(res.status).toBe(200)
    const list = await (await authed('/api/admin/friends')).json() as { friends: { link: string }[] }
    expect(list.friends.map((f) => f.link).sort()).toEqual(['https://a.example.com/', 'https://b.example.com/'])
  })
})

describe('备份校验', () => {
  it('缺确认参数、未留存当前数据时拒绝恢复', async () => {
    const { gz } = await exportBackup()
    const noConfirm = await postBackup('/api/admin/backup/restore', gz)
    expect(noConfirm.status).toBe(400)
    expect(((await noConfirm.json()) as { error: { code: string } }).error.code).toBe('confirm_required')

    const noPre = await postBackup('/api/admin/backup/restore?confirm=1', gz)
    expect(noPre.status).toBe(400)
    expect(((await noPre.json()) as { error: { code: string } }).error.code).toBe('prebackup_required')
  })

  it('拒绝空文件、坏 JSON、错误格式与断链', async () => {
    const empty = await postBackup('/api/admin/backup/preview', new Uint8Array())
    expect(empty.status).toBe(400)

    const badJson = await postBackup('/api/admin/backup/preview', 'not json at all')
    expect(badJson.status).toBe(400)
    expect(((await badJson.json()) as { error: { code: string } }).error.code).toBe('invalid_json')

    const wrongFormat = await postBackup(
      '/api/admin/backup/preview',
      JSON.stringify({ format: 'other', version: 1, exportedAt: 'x', data: { groups: [], friends: [], applications: [], settings: {} } }),
    )
    expect(wrongFormat.status).toBe(400)
    expect(((await wrongFormat.json()) as { error: { code: string } }).error.code).toBe('invalid_backup')

    const broken = {
      format: 'youlin.backup',
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      data: {
        groups: [{ name: '技术区', sort: 0 }],
        friends: [{ group: '不存在的组', author: '甲', link: 'https://x.example.com/', since: '2024-01-01', inCircle: true, status: 'active', sort: 0 }],
        applications: [],
        settings: {},
      },
    }
    const gz = await gzipBytes(new TextEncoder().encode(JSON.stringify(broken)))
    const res = await postBackup('/api/admin/backup/restore?confirm=1&downloaded=1', gz)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('broken_reference')
  })

  it('更高版本的备份给出升级提示', async () => {
    const future = {
      format: 'youlin.backup',
      version: 2,
      exportedAt: '2026-01-01T00:00:00Z',
      data: { groups: [], friends: [], applications: [], settings: {} },
    }
    const res = await postBackup('/api/admin/backup/preview', JSON.stringify(future))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('unsupported_version')
    expect(body.error.message).toContain('升级')
  })

  it('损坏的 gzip 给出明确错误', async () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02])
    const res = await postBackup('/api/admin/backup/preview', bytes)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad_gzip')
  })
})
