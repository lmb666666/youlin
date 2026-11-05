import { describe, it, expect, beforeAll } from 'vitest'
import {
  adminStatsSchema,
  applicationListResponseSchema,
  articleListResponseSchema,
  backupStatusResponseSchema,
  crawlStatusSchema,
  friendListResponseSchema,
  groupListResponseSchema,
  healthListResponseSchema,
  settingsResponseSchema,
  settingsSchemaResponseSchema,
} from '@youlin/contracts'
import { env, SELF } from '../helpers'

const BASE = 'https://example.com'
let cookie = ''

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(BASE + path, {
    ...init,
    headers: { Cookie: cookie, ...(init.headers ?? {}) },
  })
}

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const res = await authed(path, init)
  expect(res.status, `${path} -> ${res.status}`).toBeLessThan(400)
  return res.json()
}

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM source_state'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
  const login = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'test-admin-token' }),
  })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]!

  const group = (await json('/api/admin/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '契约组', desc: 'schema' }),
  })) as { id: number }
  await json('/api/admin/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId: group.id,
      title: '契约站',
      link: 'https://contract.example.com/',
      since: '2026-01-01',
    }),
  })
})

describe('管理 API 输出契约', () => {
  it('分组/友链/体检/文章/状态/统计/申请/备份/设置均可被共享 schema 解析', async () => {
    groupListResponseSchema.parse(await json('/api/admin/groups'))
    friendListResponseSchema.parse(await json('/api/admin/friends'))
    healthListResponseSchema.parse(await json('/api/admin/health'))
    articleListResponseSchema.parse(await json('/api/admin/articles'))
    crawlStatusSchema.parse(await json('/api/admin/crawl/status'))
    adminStatsSchema.parse(await json('/api/admin/stats'))
    applicationListResponseSchema.parse(await json('/api/admin/applications?status=all'))
    backupStatusResponseSchema.parse(await json('/api/admin/backup/status'))
    settingsSchemaResponseSchema.parse(await json('/api/admin/settings/schema'))
    settingsResponseSchema.parse(await json('/api/admin/settings'))
  })
})
