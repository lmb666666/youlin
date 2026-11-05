import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'undici'
import { guardedDispatcher } from '../../src/server/net'
import { fetchRemote } from '../../src/crawler/http'
import type { AppConfig, Env } from '../../src/types'

afterEach(() => vi.unstubAllGlobals())

describe('Node 出站 DNS 防护', () => {
  it('guardedDispatcher 在连接前拒绝解析到回环的域名', async () => {
    await expect(request('http://localhost:9/', { dispatcher: guardedDispatcher })).rejects.toThrow(/内网|环回/)
  })

  it('fetchRemote 在 Node 上把 dispatcher 传给 fetch', async () => {
    const dispatcher = { marker: true }
    const captured: unknown[] = []
    vi.stubGlobal('fetch', async (_input: unknown, init?: RequestInit & { dispatcher?: unknown }) => {
      captured.push(init?.dispatcher)
      return new Response('ok', { status: 200 })
    })

    const cfg = {
      site: { url: 'https://me.example.com' },
      crawl: { userAgent: 'Youlin-Test', timeoutSeconds: 5 },
      proxy: { url: '', mode: 'off' },
    } as unknown as AppConfig

    const res = await fetchRemote({ FETCH_DISPATCHER: dispatcher } as unknown as Env, {
      url: 'https://example.com/',
      cfg,
      timeoutSeconds: 5,
    })
    expect(res.status).toBe(200)
    expect(captured[0]).toBe(dispatcher)
  })
})
