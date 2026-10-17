import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'
import { gunzipBytes } from '../src/backup/codec'

/**
 * WebDAV 备份：用一个进程内的 mock WebDAV 服务（替换 globalThis.fetch）覆盖
 * 建目录、上传、列目录、保留策略、云端恢复与认证失败。
 */

const BASE = 'https://example.com'
const DAV_ORIGIN = 'https://dav.test'
const AUTH = `Basic ${btoa('davuser:davpass')}`

const store = new Map<string, { bytes: Uint8Array; at: Date }>()
let dirExists = false
const originalFetch = globalThis.fetch

function mockDav(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init)
  const url = new URL(req.url)
  if (url.origin !== DAV_ORIGIN) return originalFetch(input as RequestInfo, init)

  if (req.headers.get('authorization') !== AUTH) {
    return Promise.resolve(new Response('unauthorized', { status: 401 }))
  }
  const path = url.pathname
  if (path === '/dav' || path === '/dav/') {
    if (req.method === 'MKCOL') {
      if (dirExists) return Promise.resolve(new Response(null, { status: 405 }))
      dirExists = true
      return Promise.resolve(new Response(null, { status: 201 }))
    }
    if (req.method === 'PROPFIND') {
      const items = [...store.entries()]
        .map(
          ([name, v]) => `<d:response><d:href>/dav/${encodeURIComponent(name)}</d:href>
  <d:propstat><d:prop><d:getcontentlength>${v.bytes.length}</d:getcontentlength>
  <d:getlastmodified>${v.at.toUTCString()}</d:getlastmodified></d:prop>
  <d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        )
        .join('')
      return Promise.resolve(
        new Response(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${items}</d:multistatus>`, {
          status: 207,
          headers: { 'Content-Type': 'application/xml' },
        }),
      )
    }
  }
  if (path.startsWith('/dav/')) {
    const name = decodeURIComponent(path.slice('/dav/'.length))
    if (req.method === 'PUT') {
      return req.arrayBuffer().then((buf) => {
        store.set(name, { bytes: new Uint8Array(buf), at: new Date() })
        return new Response(null, { status: 201 })
      })
    }
    const item = store.get(name)
    if (req.method === 'GET') {
      return Promise.resolve(item ? new Response(item.bytes as unknown as BodyInit, { status: 200 }) : new Response('not found', { status: 404 }))
    }
    if (req.method === 'DELETE') {
      store.delete(name)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
  }
  return Promise.resolve(new Response('not found', { status: 404 }))
}

async function login(ip = '10.7.7.7'): Promise<string> {
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
  opts: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<Response> {
  const cookie = await login()
  return SELF.fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { Cookie: cookie, ...(opts.headers ?? {}) },
    body: opts.body,
  })
}

async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await authed(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await res.json()) as T
}

async function configureDav(extra: Record<string, unknown> = {}): Promise<void> {
  const res = await authed('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'backup.webdavUrl': 'https://dav.test/dav',
      'backup.webdavUsername': 'davuser',
      'backup.webdavPath': '',
      ...extra,
    }),
  })
  expect(res.status).toBe(200)
}

async function seedFriend(): Promise<void> {
  const g = await json<{ id: number }>('/api/admin/groups', 'POST', { name: '技术区' })
  await json('/api/admin/friends', 'POST', {
    groupId: g.id, title: '博客甲', link: 'https://a.example.com/', since: '2024-01-01',
  })
}

beforeEach(async () => {
  store.clear()
  dirExists = false
  globalThis.fetch = mockDav as typeof fetch
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM source_state'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('WebDAV 备份', () => {
  it('未配置时明确拒绝', async () => {
    const res = await authed('/api/admin/backup/webdav/run', { method: 'POST' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('webdav_not_configured')
  })

  it('连接自检会建目录并列出文件', async () => {
    await configureDav()
    const res = await authed('/api/admin/backup/webdav/test', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, files: 0 })
    expect(dirExists).toBe(true)
  })

  it('手动上传生成备份文件，状态落库，保留策略删除旧文件', async () => {
    await seedFriend()
    await configureDav({ 'backup.retain': 2 })

    // 先塞 3 个旧备份，验证保留策略只保留最近 2 个
    for (const stamp of ['20260101-000000', '20260102-000000', '20260103-000000']) {
      store.set(`youlin-backup-${stamp}.json.gz`, { bytes: new Uint8Array([1]), at: new Date(stamp.slice(0, 4) + '-01-01') })
    }
    // 恢复前存档不应被保留策略删除
    store.set('pre-restore-20251201-000000.json.gz', { bytes: new Uint8Array([1]), at: new Date('2025-12-01') })

    const res = await authed('/api/admin/backup/webdav/run', { method: 'POST' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; status: { file: string }; pruned: number }
    expect(body.ok).toBe(true)
    expect(body.status.file).toMatch(/^youlin-backup-\d{8}-\d{6}\.json\.gz$/)
    expect(body.pruned).toBeGreaterThan(0)

    const backups = [...store.keys()].filter((n) => n.startsWith('youlin-backup-')).sort()
    expect(backups).toHaveLength(2)
    expect(store.has('pre-restore-20251201-000000.json.gz')).toBe(true)

    // 上传内容确实是可解析的备份
    const uploaded = store.get(body.status.file)!
    const parsed = JSON.parse(new TextDecoder().decode(await gunzipBytes(uploaded.bytes)))
    expect(parsed.format).toBe('youlin.backup')
    expect(parsed.counts).toMatchObject({ groups: 1, friends: 1 })

    const status = await json<{ last: { ok: boolean; target: string } }>('/api/admin/backup/status')
    expect(status.last).toMatchObject({ ok: true, target: 'webdav' })
  })

  it('从云端恢复：先自动存档再覆盖，数据回来', async () => {
    await seedFriend()
    await configureDav()

    // 造一份“云端备份”：当前数据的导出
    const exp = await authed('/api/admin/backup/export')
    const bytes = new Uint8Array(await exp.arrayBuffer())
    store.set('youlin-backup-20260101-010203.json.gz', { bytes, at: new Date('2026-01-01') })

    // 改坏本地数据
    await env.DB.prepare('DELETE FROM friends').run()
    await env.DB.prepare('DELETE FROM groups').run()

    const list = await json<{ files: { name: string; size: number; lastModified?: string }[] }>('/api/admin/backup/webdav/list')
    const entry = list.files.find((f) => f.name === 'youlin-backup-20260101-010203.json.gz')!
    expect(entry.size).toBe(bytes.byteLength)
    expect(entry.lastModified).toBeTruthy()

    const res = await authed('/api/admin/backup/webdav/restore?confirm=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'youlin-backup-20260101-010203.json.gz' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; preRestoreFile: string }
    expect(body.ok).toBe(true)
    expect(body.preRestoreFile).toMatch(/^pre-restore-/)

    const links = await (await SELF.fetch(`${BASE}/api/links`)).json() as { groups: { name: string; links: unknown[] }[] }
    expect(links.groups.map((g) => g.name)).toEqual(['技术区'])
    expect(links.groups[0]!.links).toHaveLength(1)
  })

  it('认证失败给出可操作的提示', async () => {
    await configureDav({ 'backup.webdavUsername': 'wrong-user' })
    dirExists = true
    const res = await authed('/api/admin/backup/webdav/test', { method: 'POST' })
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('认证失败')
  })

  it('云端恢复拒绝非法文件名', async () => {
    await configureDav()
    const res = await authed('/api/admin/backup/webdav/restore?confirm=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '../etc/passwd' }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_name')
  })

  it('自动备份到点才执行（周期内重复 tick 不会重复上传）', async () => {
    await seedFriend()
    await configureDav({ 'backup.enabled': true, 'backup.schedule': 'daily' })

    const first = await authed('/api/admin/backup/webdav/run', { method: 'POST' })
    expect(first.status).toBe(200)
    const filesAfterFirst = [...store.keys()].filter((n) => n.startsWith('youlin-backup-')).length
    expect(filesAfterFirst).toBe(1)

    // 周期未到：直接调用 maybeRunScheduledBackup 应返回 null（通过 cron 触发路径验证）
    const { loadConfig } = await import('../src/config/loader')
    const { maybeRunScheduledBackup } = await import('../src/backup/run')
    const { cfg } = await loadConfig(env.DB, env)
    const skipped = await maybeRunScheduledBackup(env.DB, env, cfg)
    expect(skipped).toBeNull()
  })
})
