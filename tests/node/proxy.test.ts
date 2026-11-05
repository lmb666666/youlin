import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../helpers'
import { loadConfig } from '../../src/config/loader'
import { fetchRemote } from '../../src/crawler/http'
import type { AppConfig } from '../../src/types'

const originalFetch = globalThis.fetch
let calls: { url: string; dispatcher: boolean }[] = []

function stub(handler: (url: string) => Response): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, dispatcher: Boolean((init as { dispatcher?: unknown })?.dispatcher) })
    return handler(url)
  })
}

let cfg: AppConfig

beforeEach(async () => {
  calls = []
  cfg = (await loadConfig(env.DB, env)).cfg
})
afterEach(() => {
  vi.unstubAllGlobals()
  globalThis.fetch = originalFetch
})

describe('代理请求', () => {
  it('安全策略拒绝不会回退到代理', async () => {
    stub(() => {
      throw Object.assign(new Error('目标地址解析到内网/环回地址（127.0.0.1）'), { name: 'BlockedPrivateAddress' })
    })
    const r = await fetchRemote(env, {
      url: 'http://public.example.com/',
      cfg: { ...cfg, proxy: { url: 'https://proxy.example/', mode: 'fallback' } },
      timeoutSeconds: 1,
    })
    expect(r.blocked).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.dispatcher).toBe(true)
  })

  it('代理首跳的相对重定向按目标站点解析，并转为直连', async () => {
    stub((url) => {
      if (url.startsWith('https://proxy.example/')) {
        return new Response(null, { status: 302, headers: { Location: '/feed2' } })
      }
      return new Response('ok', { status: 200 })
    })
    const r = await fetchRemote(env, {
      url: 'http://93.184.216.34/',
      cfg: { ...cfg, proxy: { url: 'https://proxy.example/', mode: 'always' } },
      timeoutSeconds: 2,
    })
    expect(calls.map((c) => c.url)).toEqual([
      'https://proxy.example/http://93.184.216.34/',
      'http://93.184.216.34/feed2',
    ])
    expect(calls[1]!.dispatcher).toBe(true)
    expect(r.finalUrl).toBe('http://93.184.216.34/feed2')
    expect(r.status).toBe(200)
  })
})
