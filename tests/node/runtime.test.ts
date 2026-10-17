import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { app } from '../../src/app'
import { SqliteD1 } from '../../src/server/db'
import { applyMigrations } from '../../src/server/migrations'
import { createEnv } from '../../src/server/env'
import { gunzipBytes } from '../../src/backup/codec'
import { runScheduledJobs } from '../../src/jobs'
import type { Env } from '../../src/types'

/**
 * Node 运行时用例：真实的 better-sqlite3 + 同一套 Hono 应用。
 * 这些用例证明 Docker 路径与 Workers 路径跑的是同一份业务代码。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MIGRATIONS = path.join(ROOT, 'migrations')
const TOKEN = 'node-admin-token'

let db: SqliteD1
let env: Env
let cookie: string

beforeAll(() => {
  process.env.ADMIN_TOKEN = TOKEN
})

beforeEach(async () => {
  db?.close()
  const raw = new Database(':memory:')
  raw.pragma('foreign_keys = ON')
  applyMigrations(raw, MIGRATIONS)
  db = new SqliteD1(raw)
  env = createEnv(db)

  const res = await app.request(
    '/api/admin/login',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: TOKEN }) },
    env,
  )
  expect(res.status).toBe(200)
  cookie = res.headers.get('set-cookie')!.split(';')[0]!
})

async function call(pathname: string, init: RequestInit = {}): Promise<Response> {
  return app.request(pathname, { ...init, headers: { Cookie: cookie, ...(init.headers ?? {}) } }, env)
}

async function jsonCall<T>(pathname: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await call(pathname, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  expect(res.status, `${method} ${pathname} → ${res.status}`).toBeLessThan(400)
  return (await res.json()) as T
}

describe('SQLite 适配层', () => {
  it('迁移幂等，d1_migrations 记录已应用文件', () => {
    const again = applyMigrations(db.database, MIGRATIONS)
    expect(again.applied).toEqual([])
    expect(again.skipped).toBeGreaterThan(0)
  })

  it('run/first/all 的返回形状与 D1 一致', async () => {
    const ins = await db
      .prepare('INSERT INTO groups (name, "desc", sort) VALUES (?, ?, ?)')
      .bind('技术区', null, 3)
      .run()
    expect(ins.meta.last_row_id).toBe(1)
    expect(ins.meta.changes).toBe(1)

    const row = await db.prepare('SELECT name, sort FROM groups WHERE id = ?').bind(1).first<{ name: string; sort: number }>()
    expect(row).toEqual({ name: '技术区', sort: 3 })

    const missing = await db.prepare('SELECT name FROM groups WHERE id = ?').bind(999).first()
    expect(missing).toBeNull()

    const all = await db.prepare('SELECT name FROM groups').all<{ name: string }>()
    expect(all.results).toEqual([{ name: '技术区' }])
  })

  it('bind 归一：boolean → 0/1，undefined → null', async () => {
    const g = await db.prepare('INSERT INTO groups (name, sort) VALUES (?, ?)').bind('测试组', 0).run()
    await db
      .prepare('INSERT INTO friends (group_id, author, link, since, in_circle, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(g.meta.last_row_id, '甲', 'https://a.example/', '2024-01-01', true, 'active')
      .run()
    const row = await db.prepare('SELECT in_circle FROM friends').first<{ in_circle: number }>()
    expect(row!.in_circle).toBe(1)

    await db.prepare('INSERT INTO groups (name, "desc", sort) VALUES (?, ?, ?)').bind('未分组', undefined, 0).run()
    const desc = await db.prepare("SELECT \"desc\" AS d FROM groups WHERE name = '未分组'").first<{ d: string | null }>()
    expect(desc!.d).toBeNull()
  })

  it('batch 失败时整体回滚', async () => {
    await db.prepare('INSERT INTO groups (name, sort) VALUES (?, ?)').bind('G', 0).run()
    await expect(
      db.batch([
        db.prepare('INSERT INTO friends (group_id, author, link, since) VALUES (1, ?, ?, ?)').bind('甲', 'https://a.example/', '2024-01-01'),
        db.prepare('INSERT INTO friends (group_id, author, link, since) VALUES (1, ?, ?, ?)').bind('乙', 'https://a.example/', '2024-01-01'),
      ]),
    ).rejects.toThrow(/UNIQUE/)
    const count = await db.prepare('SELECT COUNT(*) AS n FROM friends').first<{ n: number }>()
    expect(count!.n).toBe(0)
  })
})

describe('Node 上的应用', () => {
  it('/healthz 返回 200 且不缓存', async () => {
    const res = await app.request('/healthz', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, db: true })
  })

  it('建组建档 → 公开接口可见 → 未登录被拒', async () => {
    const g = await jsonCall<{ id: number }>('/api/admin/groups', 'POST', { name: '技术区' })
    await jsonCall('/api/admin/friends', 'POST', {
      groupId: g.id, title: '博客甲', link: 'https://a.example.com/', since: '2024-01-01',
    })
    const pub = await (await app.request('/api/links', {}, env)).json() as {
      groups: { name: string; links: { author: string }[] }[]
    }
    expect(pub.groups[0]!.name).toBe('技术区')
    expect(pub.groups[0]!.links[0]!.author).toBe('博客甲')

    const denied = await app.request('/api/admin/friends', {}, env)
    expect(denied.status).toBe(401)
  })

  it('备份导出 → 清空 → 恢复，跨运行时格式一致', async () => {
    const g = await jsonCall<{ id: number }>('/api/admin/groups', 'POST', { name: '技术区' })
    await jsonCall('/api/admin/friends', 'POST', {
      groupId: g.id, title: '博客甲', link: 'https://a.example.com/', since: '2024-01-01', comment: '互访',
    })
    await jsonCall('/api/admin/settings', 'PUT', { 'site.name': 'Node 实例' })

    const exp = await call('/api/admin/backup/export')
    expect(exp.status).toBe(200)
    const gz = new Uint8Array(await exp.arrayBuffer())
    const envelope = JSON.parse(new TextDecoder().decode(await gunzipBytes(gz))) as {
      format: string
      counts: { groups: number; friends: number }
      data: { settings: Record<string, unknown> }
    }
    expect(envelope.format).toBe('youlin.backup')
    expect(envelope.counts).toMatchObject({ groups: 1, friends: 1 })
    expect(envelope.data.settings['site.name']).toBe('Node 实例')

    await db.exec('DELETE FROM friends; DELETE FROM groups;')
    const res = await call('/api/admin/backup/restore?confirm=1&downloaded=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: gz as unknown as RequestInit['body'],
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; summary: { friends: number } }
    expect(body.ok).toBe(true)
    expect(body.summary.friends).toBe(1)

    const pub = await (await app.request('/api/links', {}, env)).json() as { groups: { links: { comment?: string }[] }[] }
    expect(pub.groups[0]!.links[0]!.comment).toBe('互访')
    const settings = await jsonCall<{ values: Record<string, unknown> }>('/api/admin/settings')
    expect(settings.values['site.name']).toBe('Node 实例')
  })

  it('定时作业可在进程内运行（抓取关闭时只做清理）', async () => {
    await jsonCall('/api/admin/settings', 'PUT', { 'crawl.enabled': false, 'backup.enabled': false })
    const { loadConfig } = await import('../../src/config/loader')
    const { cfg } = await loadConfig(env.DB, env)
    const summary = await runScheduledJobs(env.DB, env, cfg)
    expect(summary.crawl.total).toBe(0)
    expect(summary.backup).toBeNull()
  })

  it('静态资源与 SPA fallback 由 Node 处理器负责', async () => {
    // 自建临时静态目录，不依赖 pnpm build（CI 里 test 先于 build）
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'youlin-web-'))
    fs.mkdirSync(path.join(root, 'assets'))
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>youlin</title>')
    fs.writeFileSync(path.join(root, 'assets', 'app-abc123.js'), 'console.log(1)')

    try {
      const { createFetchHandler } = await import('../../src/server/assets')
      const handler = createFetchHandler(root, (req, e) => app.fetch(req, e, undefined))

      const api = await handler(new Request('http://local/api/links'), env)
      expect(api.headers.get('content-type')).toContain('application/json')

      const spa = await handler(new Request('http://local/admin/links'), env)
      expect(spa.status).toBe(200)
      expect(spa.headers.get('content-type')).toContain('text/html')
      expect(spa.headers.get('cache-control')).toBe('no-cache')

      const asset = await handler(new Request('http://local/assets/app-abc123.js'), env)
      expect(asset.status).toBe(200)
      expect(asset.headers.get('cache-control')).toContain('immutable')

      const missingAsset = await handler(new Request('http://local/assets/nope.js'), env)
      expect(missingAsset.status).toBe(404)

      const traversal = await handler(new Request('http://local/../package.json'), env)
      expect(traversal.status).not.toBe(200)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
