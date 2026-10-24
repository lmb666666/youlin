import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import { env } from './helpers'
import { isPrivateTarget } from '../src/crawler/http'
import { clientIp, isPrivateIp } from '../src/util/ip'

/**
 * 出站请求防护（SSRF）与客户端 IP 判定。
 * fetchRemote 在发起任何请求前先过 isPrivateTarget，抓取/体检/反链/申请共用这一道闸。
 */

describe('isPrivateTarget：内网/环回/非法协议拒绝', () => {
  const blocked = [
    'http://127.0.0.1:8787/admin',
    'http://localhost/',
    'http://LOCALHOST:3000/',
    'http://10.0.0.1/',
    'http://172.16.0.9/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://app.local/',
    'http://svc.internal/',
    'ftp://example.com/',
    'file:///etc/passwd',
    'not a url',
  ]
  const allowed = ['https://example.com/', 'http://8.8.8.8/', 'https://blog.example.com/feed.xml', 'http://[2001:db8::1]/']

  it.each(blocked)('拦截 %s', (url) => {
    expect(isPrivateTarget(url)).toBe(true)
  })
  it.each(allowed)('放行 %s', (url) => {
    expect(isPrivateTarget(url)).toBe(false)
  })
})

describe('isPrivateIp', () => {
  it('识别 IPv4 私有段、环回、链路本地与 IPv4 映射', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.31.255.1', '169.254.169.254', '0.1.2.3', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fd00::1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '203.0.113.9', '2001:db8::1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe('clientIp：来源判定', () => {
  function fakeCtx(headers: Record<string, string>, env: unknown = {}) {
    return {
      req: { header: (k: string) => headers[k.toLowerCase()] },
      env,
    }
  }

  it('Workers：cf-connecting-ip 优先且不受 XFF 影响', () => {
    const ip = clientIp(fakeCtx({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' }))
    expect(ip).toBe('203.0.113.7')
  })

  it('无 cf 头时回退 XFF 首段（测试环境路径）', () => {
    expect(clientIp(fakeCtx({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1')
    expect(clientIp(fakeCtx({}))).toBe('local')
  })

  it('Node 直连：socket 是公网地址时直接采信，伪造 XFF 无效', () => {
    const env = { incoming: { socket: { remoteAddress: '203.0.113.9' } } }
    expect(clientIp(fakeCtx({ 'x-forwarded-for': '1.2.3.4' }, env))).toBe('203.0.113.9')
  })

  it('Node 带本地反代：socket 为回环/私网时取 XFF 最后一档（由可信代理追加）', () => {
    const loopback = { incoming: { socket: { remoteAddress: '127.0.0.1' } } }
    const lan = { incoming: { socket: { remoteAddress: '192.168.1.5' } } }
    expect(clientIp(fakeCtx({ 'x-forwarded-for': '198.51.100.2, 203.0.113.10' }, loopback))).toBe('203.0.113.10')
    expect(clientIp(fakeCtx({}, loopback))).toBe('127.0.0.1')
    expect(clientIp(fakeCtx({ 'x-forwarded-for': '198.51.100.2' }, lan))).toBe('198.51.100.2')
  })
})

describe('申请反链检测：内网目标不出站', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM applications'),
      env.DB.prepare('DELETE FROM apply_rate_limit'),
      env.DB.prepare('DELETE FROM friends'),
      env.DB.prepare('DELETE FROM groups'),
      env.DB.prepare('DELETE FROM settings'),
    ])
    await env.DB.batch(
      [
        ['apply.turnstile', false],
        ['apply.backlinkPolicy', 'mark'],
        ['site.url', 'https://me.example.com/'],
      ].map(([k, v]) =>
        env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
          .bind(k, JSON.stringify(v)),
      ),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('提交指向内网的站点：直接判定无法访问，不发起任何出站请求', async () => {
    const guard = vi.fn(() => {
      throw new Error('内网目标不应发起出站请求')
    })
    vi.stubGlobal('fetch', guard)

    const res = await SELF.fetch('https://example.com/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '10.9.9.9' },
      body: JSON.stringify({ siteName: '内网站', link: 'http://127.0.0.1:9/', desc: '探测' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { backlink: { ok: boolean | null; detail: string | null } }
    expect(body.backlink.ok).toBeNull()
    expect(body.backlink.detail).toContain('不可抓取')
    expect(guard).not.toHaveBeenCalled()
  })
})
