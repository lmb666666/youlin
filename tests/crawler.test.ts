import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { env } from './helpers'
import { nextIntervalHours } from '../src/crawler/http'
import { crawlSource, dailyCleanup, runCronTick } from '../src/crawler/crawl'
import { loadConfig } from '../src/config/loader'
import type { AppConfig } from '../src/types'

function rssXml(items: { title: string; link: string; pubDate: string; guid?: string }[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link>${i.guid ? `<guid>${i.guid}</guid>` : ''}<pubDate>${i.pubDate}</pubDate></item>`,
    )
    .join('')}</channel></rss>`
}

function okResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/xml', ...headers } })
}

async function seedFriend(feed: string | null, inCircle = 1): Promise<{ id: number; base: string; feedUrl: string | null }> {
  const base = `https://t-${Math.random().toString(36).slice(2, 8)}.example.com/`
  const g = await env.DB.prepare('INSERT INTO groups (name) VALUES (?) RETURNING id').bind(`g-${Math.random()}`).first<{ id: number }>()
  const feedUrl = feed === null ? null : `${base}feed.xml`
  const f = await env.DB.prepare('INSERT INTO friends (group_id, author, link, feed, in_circle, since) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(g!.id, 'T', base, feedUrl, inCircle, '2026-01-01')
    .first<{ id: number }>()
  return { id: f!.id, base, feedUrl }
}

let fetchCalls: { url: string; headers: Record<string, string> }[] = []

function stubFetch(handler: (url: string, headers: Record<string, string>) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = (init?.headers ?? {}) as Record<string, string>
      fetchCalls.push({ url, headers })
      return handler(url, headers)
    },
  )
}

beforeEach(() => {
  fetchCalls = []
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const base = 'https://t.example.com/'
const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toUTCString()

describe('RSS 抓取', () => {
  it('200 → 解析入库、状态更新、记录 ETag', async () => {
    const { id: fid, feedUrl } = await seedFriend('feed')
    stubFetch(() => okResponse(rssXml([
      { title: 'A', link: base + 'a', pubDate: D(1), guid: 'a' },
      { title: 'B', link: base + 'b', pubDate: D(2), guid: 'b' },
    ]), { ETag: '"v1"' }))

    const { cfg } = await loadConfig(env.DB, env)
    const outcome = await crawlSource(env.DB, env, cfg, { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 })
    expect(outcome).toBe('ok')

    const articles = await env.DB.prepare('SELECT guid, title FROM articles WHERE friend_id = ? ORDER BY published_at DESC').bind(fid).all<{ guid: string; title: string }>()
    expect(articles.results.map((a) => a.guid)).toEqual(['a', 'b'])

    const state = await env.DB.prepare('SELECT reachable, crawlable, best_method, etag, fail_count FROM source_state WHERE friend_id = ?').bind(fid).first<{ reachable: number; crawlable: number; best_method: string; etag: string; fail_count: number }>()
    expect(state).toMatchObject({ reachable: 1, crawlable: 1, best_method: 'rss', etag: '"v1"', fail_count: 0 })

    // 复查间隔按"小时"推进（linkCheck.maxAgeHours=24 → next_check_at ≈ 24h 后，而非 24 分钟）
    const gap = await env.DB.prepare("SELECT (julianday(next_check_at) - julianday('now')) * 24 AS hours FROM source_state WHERE friend_id = ?").bind(fid).first<{ hours: number }>()
    expect(gap!.hours).toBeGreaterThan(23.5)
    expect(gap!.hours).toBeLessThan(24.5)
  })

  it('第二次请求带 If-None-Match，304 → 只更新状态、文章不变', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    stubFetch(() => okResponse(rssXml([{ title: 'A', link: base + 'a', pubDate: D(1), guid: 'a' }]), { ETag: '"v1"' }))
    const { cfg } = await loadConfig(env.DB, env)
    const friend = { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 }

    await crawlSource(env.DB, env, cfg, friend)
    await crawlSource(env.DB, env, cfg, friend)

    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[1]!.headers['If-None-Match']).toBe('"v1"')

    const articles = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE friend_id = ?').bind(fid).first<{ n: number }>()
    expect(articles?.n).toBe(1)
    const state = await env.DB.prepare('SELECT crawlable, last_ok_at IS NOT NULL AS has_ok FROM source_state WHERE friend_id = ?').bind(fid).first<{ crawlable: number; has_ok: number }>()
    expect(state).toMatchObject({ crawlable: 1, has_ok: 1 })
  })

  it('maxPerFriend 截断 + 未来时间容差过滤', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    const items = Array.from({ length: 8 }, (_, i) => ({ title: `P${i}`, link: `${base}p${i}`, pubDate: D(i + 1), guid: `p${i}` }))
    items.push({ title: '未来太久', link: `${base}future`, pubDate: new Date(Date.now() + 10 * 86_400_000).toUTCString(), guid: 'future' })
    items.push({ title: '容差内未来', link: `${base}near-future`, pubDate: new Date(Date.now() + 86_400_000).toUTCString(), guid: 'near-future' })
    stubFetch(() => okResponse(rssXml(items)))

    const { cfg } = await loadConfig(env.DB, env)
    await crawlSource(env.DB, env, cfg, { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 })

    const rows = await env.DB.prepare('SELECT guid FROM articles WHERE friend_id = ? ORDER BY published_at DESC').bind(fid).all<{ guid: string }>()
    expect(rows.results).toHaveLength(5) // maxPerFriend=5
    expect(rows.results.map((r) => r.guid)).toContain('near-future')
    expect(rows.results.map((r) => r.guid)).not.toContain('future')
  })

  it('网络错误 → 失联标记 + 退避 next_check_at', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    stubFetch(() => {
      throw new Error('dns fail')
    })
    const { cfg } = await loadConfig(env.DB, env)
    const outcome = await crawlSource(env.DB, env, cfg, { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 })
    expect(outcome).toBe('failed')

    const state = await env.DB.prepare('SELECT reachable, crawlable, unreachable_since IS NOT NULL AS has_since, fail_count, last_error FROM source_state WHERE friend_id = ?').bind(fid).first<{ reachable: number; crawlable: number; has_since: number; fail_count: number; last_error: string }>()
    expect(state).toMatchObject({ reachable: 0, crawlable: 0, has_since: 1, fail_count: 1 })
    expect(state!.last_error).toContain('dns fail')
  })

  it('feed 404 + 首页正常 → 可达但 RSS 不可用（不误报整站失联）', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    stubFetch((url) => {
      if (url === feedUrl) return new Response('gone', { status: 404 })
      if (url === base) {
        return new Response('<html><head><title>T</title></head><body>hi</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      return new Response('not found', { status: 404 }) // 常见 feed 路径探测全部 404
    })
    const { cfg } = await loadConfig(env.DB, env)
    const outcome = await crawlSource(env.DB, env, cfg, { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 })
    expect(outcome).toBe('ok') // 站点可达（首页兜底），仅 RSS 不可用

    const state = await env.DB.prepare(
      'SELECT reachable, crawlable, best_method, rss_unavailable_since IS NOT NULL AS has_rss_since, unreachable_since IS NULL AS no_unreachable FROM source_state WHERE friend_id = ?',
    )
      .bind(fid)
      .first<{ reachable: number; crawlable: number; best_method: string; has_rss_since: number; no_unreachable: number }>()
    expect(state).toMatchObject({ reachable: 1, crawlable: 0, best_method: 'homepage', has_rss_since: 1, no_unreachable: 1 })
  })

  it('feed 挂 + 首页也不可达 → 失联并退避', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    stubFetch(() => new Response('down', { status: 503 }))
    const { cfg } = await loadConfig(env.DB, env)
    const outcome = await crawlSource(env.DB, env, cfg, { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 })
    expect(outcome).toBe('failed')
    const state = await env.DB.prepare('SELECT reachable, unreachable_since IS NOT NULL AS has_since FROM source_state WHERE friend_id = ?').bind(fid).first<{ reachable: number; has_since: number }>()
    expect(state).toMatchObject({ reachable: 0, has_since: 1 })
  })

  it('无 feed 源体检发现 feed 时自动写回 friends.feed（未指定则自动探测）', async () => {
    const { id: fid, base } = await seedFriend(null)
    const discovered = `${base}feed.xml`
    stubFetch((url) => {
      if (url === base) {
        return new Response(
          `<html><head><link rel="alternate" type="application/rss+xml" href="feed.xml"></head><body></body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        )
      }
      if (url === discovered) return okResponse(rssXml([{ title: 'N', link: base + 'n', pubDate: D(1), guid: 'n' }]))
      return new Response('nf', { status: 404 })
    })
    const { cfg } = await loadConfig(env.DB, env)
    const outcome = await crawlSource(env.DB, env, cfg, { id: fid, author: 'T', link: base, feed: null, in_circle: 1 })
    expect(outcome).toBe('ok')

    const row = await env.DB.prepare('SELECT feed FROM friends WHERE id = ?').bind(fid).first<{ feed: string }>()
    expect(row?.feed).toBe(discovered)
    const state = await env.DB.prepare('SELECT reachable, crawlable FROM source_state WHERE friend_id = ?').bind(fid).first<{ reachable: number; crawlable: number }>()
    expect(state).toMatchObject({ reachable: 1, crawlable: 1 })
  })

  it('已配置 feed 的源不会被体检发现结果覆盖', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    stubFetch((url) => {
      if (url === feedUrl) return new Response('gone', { status: 404 })
      if (url === base) {
        return new Response(
          `<html><head><link rel="alternate" type="application/rss+xml" href="${base}other-feed.xml"></head></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html' } },
        )
      }
      return okResponse(rssXml([{ title: 'X', link: base + 'x', pubDate: D(1), guid: 'x' }]))
    })
    const { cfg } = await loadConfig(env.DB, env)
    await crawlSource(env.DB, env, cfg, { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 })
    const row = await env.DB.prepare('SELECT feed FROM friends WHERE id = ?').bind(fid).first<{ feed: string }>()
    expect(row?.feed).toBe(feedUrl) // 人工配置优先，永远不被自动发现覆盖
  })
})

describe('Cron 轮转', () => {
  it('runCronTick 只取 batchSize 个到期源，下一轮取剩余', async () => {
    stubFetch(() => new Response('down', { status: 503 })) // 全部失败，只关心选取行为
    const { cfg } = await loadConfig(env.DB, env)

    // 清空所有 friends，造 4 个到期源
    await env.DB.batch([env.DB.prepare('DELETE FROM articles'), env.DB.prepare('DELETE FROM source_state'), env.DB.prepare('DELETE FROM friends')])
    const ids: number[] = []
    for (let i = 0; i < 4; i++) ids.push((await seedFriend(null)).id)

    const first = await runCronTick(env.DB, env, cfg)
    expect(first.total).toBe(3) // batchSize=3

    const processed = await env.DB.prepare('SELECT COUNT(*) AS n FROM source_state WHERE checked_at IS NOT NULL').first<{ n: number }>()
    expect(processed?.n).toBe(3)

    const second = await runCronTick(env.DB, env, cfg)
    expect(second.total).toBe(1) // 剩余 1 个到期源
  })
})

describe('退避阶梯与清理', () => {
  it('nextIntervalHours：失联越久复查越疏', () => {
    const { cfg } = { cfg: { linkCheck: { backoffLadder: [[10, 120], [30, 240], [60, 360]], maxAgeHours: 24 } } as unknown as AppConfig }
    expect(nextIntervalHours(null, cfg, 24)).toBe(24)
    expect(nextIntervalHours(0, cfg, 24)).toBe(24)
    expect(nextIntervalHours(9, cfg, 24)).toBe(24)
    expect(nextIntervalHours(10, cfg, 24)).toBe(120)
    expect(nextIntervalHours(30, cfg, 24)).toBe(240)
    expect(nextIntervalHours(60, cfg, 24)).toBe(360)
    expect(nextIntervalHours(100, cfg, 24)).toBe(360)
  })

  it('dailyCleanup：删除超期文章，24h 内不重复执行', async () => {
    const { id: fid } = await seedFriend(null)
    const { cfg } = await loadConfig(env.DB, env)
    await env.DB.prepare("DELETE FROM settings WHERE key = 'internal.lastCleanupAt'").run()
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    await env.DB.batch([
      env.DB.prepare('INSERT INTO articles (friend_id, guid, title, link, published_at) VALUES (?, ?, ?, ?, ?)').bind(fid, 'old', '老文章', 'https://t.example.com/old', iso(200)),
      env.DB.prepare('INSERT INTO articles (friend_id, guid, title, link, published_at) VALUES (?, ?, ?, ?, ?)').bind(fid, 'new', '新文章', 'https://t.example.com/new', iso(2)),
    ])

    await dailyCleanup(env.DB, cfg)
    const after = await env.DB.prepare('SELECT guid FROM articles WHERE friend_id = ?').bind(fid).all<{ guid: string }>()
    expect(after.results.map((r) => r.guid)).toEqual(['new'])

    const marker = await env.DB.prepare("SELECT value FROM settings WHERE key = 'internal.lastCleanupAt'").first<{ value: string }>()
    expect(marker).toBeTruthy()

    // 24h 内第二次调用不再执行（即使又插入超期文章也不删）
    await env.DB.prepare('INSERT INTO articles (friend_id, guid, title, link, published_at) VALUES (?, ?, ?, ?, ?)').bind(fid, 'old2', '又老', 'https://t.example.com/old2', iso(300)).run()
    await dailyCleanup(env.DB, cfg)
    const after2 = await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE friend_id = ?').bind(fid).first<{ n: number }>()
    expect(after2?.n).toBe(2)
  })
})

describe('体检三路', () => {
  it('RSS 失败 → 首页可达但无 feed → homepage 兜底 + 反链检测写回', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    stubFetch((url) => {
      if (url === feedUrl) return new Response('not found', { status: 404 })
      // 首页：无声明 feed，含指向自家站点的链接
      return new Response(
        `<html><head><title>T</title></head><body><a href="https://me.example.com/post/1">友链</a></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    })
    const { cfg } = await loadConfig(env.DB, env)
    const withBacklink: AppConfig = { ...cfg, backlink: { enabled: true, authorUrl: 'https://me.example.com' } }
    const { checkFriendHealth, persistHealth } = await import('../src/crawler/linkcheck')
    const friend = { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 }
    const result = await checkFriendHealth(env, withBacklink, friend)
    expect(result.reachable).toBe(true)
    expect(result.crawlable).toBe(false) // feed 404 且页面无声明 feed → homepage 兜底
    expect(result.bestMethod).toBe('homepage')
    expect(result.backlinkChecked).toBe(true)
    expect(result.backlink).toBe(true)

    await persistHealth(env.DB, withBacklink, fid, result, null)
    const state = await env.DB.prepare(
      'SELECT reachable, crawlable, best_method, backlink_checked, backlink, checked_at IS NOT NULL AS has_checked FROM source_state WHERE friend_id = ?',
    )
      .bind(fid)
      .first<{ reachable: number; crawlable: number; best_method: string; backlink_checked: number; backlink: number; has_checked: number }>()
    expect(state).toMatchObject({ reachable: 1, crawlable: 0, best_method: 'homepage', backlink_checked: 1, backlink: 1, has_checked: 1 })
  })

  it('站点不可达且无状态 API → reachable=0，next_check 走退避', async () => {
    const { id: fid } = await seedFriend(null)
    stubFetch(() => {
      throw new Error('timeout')
    })
    const { cfg } = await loadConfig(env.DB, env)
    const { checkFriendHealth, persistHealth } = await import('../src/crawler/linkcheck')
    const result = await checkFriendHealth(env, cfg, { id: fid, author: 'T', link: 'https://t-dead.example.com/', feed: null, in_circle: 1 })
    expect(result.reachable).toBe(false)
    expect(result.bestMethod).toBe('none')

    await persistHealth(env.DB, cfg, fid, result, null)
    const state = await env.DB.prepare('SELECT reachable, unreachable_since IS NOT NULL AS has_since, fail_count FROM source_state WHERE friend_id = ?').bind(fid).first<{ reachable: number; has_since: number; fail_count: number }>()
    expect(state).toMatchObject({ reachable: 0, has_since: 1, fail_count: 1 })
  })

  it('RSS 正常 → reachable+crawlable，且提取最近发文', async () => {
    const { id: fid, base, feedUrl } = await seedFriend('feed')
    stubFetch((url) => {
      if (url === feedUrl) return okResponse(rssXml([{ title: 'P1', link: base + 'p1', pubDate: D(3), guid: 'p1' }]))
      return new Response('unused', { status: 500 })
    })
    const { cfg } = await loadConfig(env.DB, env)
    const { checkFriendHealth, persistHealth } = await import('../src/crawler/linkcheck')
    const result = await checkFriendHealth(env, cfg, { id: fid, author: 'T', link: base, feed: feedUrl, in_circle: 1 })
    expect(result).toMatchObject({ reachable: true, crawlable: true, bestMethod: 'rss' })
    expect(result.lastPostPublished).toBeTruthy()

    await persistHealth(env.DB, cfg, fid, result, null)
    const state = await env.DB.prepare('SELECT reachable, crawlable, best_method, last_post_days_ago FROM source_state WHERE friend_id = ?').bind(fid).first<{ reachable: number; crawlable: number; best_method: string; last_post_days_ago: number }>()
    expect(state).toMatchObject({ reachable: 1, crawlable: 1, best_method: 'rss', last_post_days_ago: 3 })
  })
})
