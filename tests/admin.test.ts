import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'

const BASE = 'https://example.com'

async function login(ip: string, token = 'test-admin-token'): Promise<Response> {
  return SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ token }),
  })
}

function cookieOf(res: Response): string {
  const raw = res.headers.get('set-cookie')!
  return raw.split(';')[0]!
}

async function authed(
  path: string,
  opts: { method?: string; body?: string; ip?: string } = {},
): Promise<Response> {
  const loginRes = await login(opts.ip ?? '10.1.1.1')
  return SELF.fetch(BASE + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: cookieOf(loginRes) },
    body: opts.body,
  })
}

beforeEach(async () => {
  // 同一文件内状态跨用例持久，先清空业务表
  await env.DB.batch([
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})

describe('鉴权', () => {
  it('正确口令 → 签发 HMAC Cookie；/me 可用；登出后失效', async () => {
    const res = await login('10.2.0.1')
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain('youlin_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    const cookie = cookieOf(res)

    const me = await SELF.fetch(`${BASE}/api/admin/me`, { headers: { Cookie: cookie } })
    expect(me.status).toBe(200)

    const out = await SELF.fetch(`${BASE}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie } })
    expect(out.status).toBe(200)
  })

  it('错误口令 → 401', async () => {
    const res = await login('10.2.0.2', 'wrong-token')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'bad_token' } })
  })

  it('无 Cookie 访问管理 API → 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/friends`)
    expect(res.status).toBe(401)
  })

  it('篡改签名 → 401', async () => {
    const cookie = cookieOf(await login('10.2.0.3'))
    const [payload, sig] = cookie.split('=').slice(1).join('=').split('.')
    const forged = `youlin_session=${payload}.${sig!.slice(0, -2)}xx`
    const res = await SELF.fetch(`${BASE}/api/admin/me`, { headers: { Cookie: forged } })
    expect(res.status).toBe(401)
  })

  it('登录限流：同 IP 超限后 429（security.loginRateLimit=5/小时）', async () => {
    const ip = '10.2.0.4'
    for (let i = 0; i < 5; i++) {
      const r = await login(ip, 'wrong-token')
      expect(r.status).toBe(401)
    }
    const blocked = await login(ip, 'test-admin-token') // 即使口令正确也被拦
    expect(blocked.status).toBe(429)
    // 换 IP 不受影响
    const other = await login('10.2.0.5')
    expect(other.status).toBe(200)
  })
})

describe('分组与友链 CRUD', () => {
  it('分组：创建/重名 409/更新/删除', async () => {
    const created = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: '技术区', desc: '技术博客' }) })
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: number }

    const dup = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: '技术区' }) })
    expect(dup.status).toBe(409)

    const patched = await authed(`/api/admin/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ desc: '更新后的描述' }) })
    expect(patched.status).toBe(200)
    const list = await authed('/api/admin/groups')
    const { groups } = (await list.json()) as { groups: { id: number; name: string; desc?: string }[] }
    expect(groups.find((g) => g.id === id)?.desc).toBe('更新后的描述')

    const del = await authed(`/api/admin/groups/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const list2 = await authed('/api/admin/groups')
    const { groups: g2 } = (await list2.json()) as { groups: { id: number }[] }
    expect(g2.find((g) => g.id === id)).toBeUndefined()
  })

  it('友链：创建→列表→更新→隐藏→删除；重复 link 409', async () => {
    const g = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: '朋友们' }) })
    const { id: gid } = (await g.json()) as { id: number }

    const f = await authed('/api/admin/friends', {
      method: 'POST',
      body: JSON.stringify({
        groupId: gid, author: 'Liang', title: 'Liang 的博客', link: 'https://blog.liang.one/',
        feed: 'https://blog.liang.one/atom.xml', archs: ['Nuxt'], since: '2024-08-25', comment: '好友',
      }),
    })
    expect(f.status).toBe(201)
    const { id } = (await f.json()) as { id: number }

    const dup = await authed('/api/admin/friends', {
      method: 'POST',
      body: JSON.stringify({ groupId: gid, author: 'X', link: 'https://blog.liang.one/', since: '2026-01-01' }),
    })
    expect(dup.status).toBe(409)
    expect(await dup.json()).toMatchObject({ error: { code: 'duplicate_link' } })

    // 非法 link 400
    const bad = await authed('/api/admin/friends', {
      method: 'POST',
      body: JSON.stringify({ groupId: gid, author: 'X', link: 'ftp://nope', since: '2026-01-01' }),
    })
    expect(bad.status).toBe(400)

    // 列表含分组名与管理字段
    const list = await authed('/api/admin/friends')
    const { friends } = (await list.json()) as { friends: Record<string, unknown>[] }
    const row = friends.find((x) => x.id === id)!
    expect(row).toMatchObject({ author: 'Liang', groupName: '朋友们', inCircle: true, status: 'active' })
    expect(row.archs).toEqual(['Nuxt'])
    expect(typeof row.createdAt).toBe('string')

    // 隐藏 → 接口一不再输出；恢复 → 输出
    await authed(`/api/admin/friends/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) })
    const pub = await (await SELF.fetch(`${BASE}/api/links`)).json() as { groups: { links: unknown[] }[] }
    expect(pub.groups[0]!.links).toEqual([])
    await authed(`/api/admin/friends/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) })
    const pub2 = await (await SELF.fetch(`${BASE}/api/links`)).json() as { groups: { links: { author: string }[] }[] }
    expect(pub2.groups[0]!.links.map((l) => l.author)).toContain('Liang')

    // 删除
    const del = await authed(`/api/admin/friends/${id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const list2 = await authed('/api/admin/friends')
    const { friends: f2 } = (await list2.json()) as { friends: { id: number }[] }
    expect(f2.find((x) => x.id === id)).toBeUndefined()
  })

  it('拖拽排序 reorder 生效并反映在接口一顺序', async () => {
    const g = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: '排序' }) })
    const { id: gid } = (await g.json()) as { id: number }
    const ids: number[] = []
    for (const [i, author] of ['A', 'B', 'C'].entries()) {
      const r = await authed('/api/admin/friends', {
        method: 'POST',
        body: JSON.stringify({ groupId: gid, author, link: `https://${author}.example.com/`, since: '2026-01-0' + (i + 1) }),
      })
      ids.push(((await r.json()) as { id: number }).id)
    }
    // B 提到最前
    const reorder = await authed('/api/admin/friends/reorder', {
      method: 'POST',
      body: JSON.stringify({ items: [{ id: ids[1]!, sort: 0 }, { id: ids[0]!, sort: 1 }, { id: ids[2]!, sort: 2 }] }),
    })
    expect(reorder.status).toBe(200)

    const pub = await (await SELF.fetch(`${BASE}/api/links`)).json() as { groups: { links: { author: string }[] }[] }
    expect(pub.groups[0]!.links.map((l) => l.author)).toEqual(['B', 'A', 'C'])
  })
})

describe('导入', () => {
  it('数组形状：字段别名映射 + 按 link 去重', async () => {
    const res = await authed('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify([
        { name: 'Liang', url: 'https://blog.liang.one/', rss: 'https://blog.liang.one/atom.xml', avatar: 'https://a/1.webp', since: '2024-08-25' },
        { author: 'Aki', site: 'https://aki.example.com/', group: '技术区' },
      ]),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { imported: number; updated: number; skipped: number; groupsCreated: number }
    expect(body).toMatchObject({ imported: 2, updated: 0, skipped: 0 })

    const list = await authed('/api/admin/friends')
    const { friends } = (await list.json()) as { friends: { author: string; groupName?: string; feed?: string }[] }
    const liang = friends.find((f) => f.author === 'Liang')!
    expect(liang.feed).toBe('https://blog.liang.one/atom.xml')
    expect(friends.find((f) => f.author === 'Aki')?.groupName).toBe('技术区')

    // 再导一次：同 link → updated
    const again = await authed('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify([{ name: 'Liang2', url: 'https://blog.liang.one/', description: '新简介' }]),
    })
    const againBody = (await again.json()) as { imported: number; updated: number }
    expect(againBody).toMatchObject({ imported: 0, updated: 1 })
  })

  it('{ groups: [...] } 形状：分组名继承', async () => {
    const res = await authed('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify({
        groups: [{ name: '技术区', links: [{ author: 'Bo', url: 'https://bo.example.com/' }] }],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { imported: number; groupsCreated: number }
    expect(body.imported).toBe(1)
    expect(body.groupsCreated).toBe(1)
  })

  it('坏条目计入 skipped 并带原因', async () => {
    const res = await authed('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify([{ author: '没有链接' }, { url: 'https://ok.example.com/' }]),
    })
    const body = (await res.json()) as { imported: number; skipped: number; errors: { index: number; message: string }[] }
    expect(body.imported).toBe(1)
    expect(body.skipped).toBe(1)
    expect(body.errors[0]!.index).toBe(0)
  })
})

describe('设置中心', () => {
  it('默认值完整返回；schema 与定义一致', async () => {
    const res = await authed('/api/admin/settings')
    const { version, values } = (await res.json()) as { version: number; values: Record<string, unknown> }
    expect(version).toBe(1)
    expect(values['site.name']).toBe('我的博客')
    expect(values['crawl.batchSize']).toBe(3)
    expect(values['api.cacheSeconds']).toBe(300)
    expect(values['linkCheck.backoffLadder']).toEqual([[10, 120], [30, 240], [60, 360]])
    expect(values['apply.requiredFields']).toEqual(['siteName', 'link'])

    const schemaRes = await authed('/api/admin/settings/schema')
    const schema = (await schemaRes.json()) as { version: number; groups: { key: string; fields: { key: string; default: unknown }[] }[] }
    expect(schema.version).toBe(1)
    for (const g of schema.groups) {
      for (const f of g.fields) {
        expect(f.key in values, `配置键 ${f.key} 应有值`).toBe(true)
      }
    }
  })

  it('PUT 更新合法键；未知键 400；类型错误 400', async () => {
    const ok = await authed('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'api.cacheSeconds': 60, 'site.name': '新名字' }) })
    expect(ok.status).toBe(200)
    const { values } = (await ok.json()) as { values: Record<string, unknown> }
    expect(values['api.cacheSeconds']).toBe(60)
    expect(values['site.name']).toBe('新名字')
    expect(values['crawl.batchSize']).toBe(3) // 未提交的键不变

    const unknown = await authed('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'nope.key': 1 }) })
    expect(unknown.status).toBe(400)

    const badType = await authed('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'crawl.batchSize': 'three' }) })
    expect(badType.status).toBe(400)

    const outOfRange = await authed('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'crawl.batchSize': 999 }) })
    expect(outOfRange.status).toBe(400)
  })

  it('导出→导入 roundtrip 值一致', async () => {
    await authed('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'ui.theme': 'dark', 'api.corsOrigin': 'https://me.example.com' }) })
    const exp = await authed('/api/admin/settings/export')
    expect(exp.headers.get('content-disposition')).toContain('youlin-settings.json')
    const exported = (await exp.json()) as Record<string, unknown>

    // 重置（import 是整表替换：先改一个键，导入后应回到导出的值）
    await authed('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'ui.theme': 'light' }) })
    const imp = await authed('/api/admin/settings/import', { method: 'POST', body: JSON.stringify(exported) })
    expect(imp.status).toBe(200)
    const { values } = (await imp.json()) as { values: Record<string, unknown> }
    expect(values['ui.theme']).toBe('dark')
    expect(values['api.corsOrigin']).toBe('https://me.example.com')
  })
})

describe('导出', () => {
  it('JSON 全量导出含管理字段；不支持的格式返回 400', async () => {
    const g = await authed('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name: '导出组' }) })
    const { id: gid } = (await g.json()) as { id: number }
    await authed('/api/admin/friends', {
      method: 'POST',
      body: JSON.stringify({ groupId: gid, author: 'X', link: 'https://x.example.com/', since: '2026-03-03', status: 'hidden', nickname: '小站' }),
    })
    const res = await authed('/api/admin/export')
    const body = (await res.json()) as { exportedAt: string; groups: { name: string; links: Record<string, unknown>[] }[] }
    expect(typeof body.exportedAt).toBe('string')
    const link = body.groups.find((x) => x.name === '导出组')!.links[0]!
    expect(link).toMatchObject({ author: 'X', status: 'hidden', nickname: '小站', inCircle: true })

    const csv = await authed('/api/admin/export?format=csv')
    expect(csv.status).toBe(400)
  })
})
