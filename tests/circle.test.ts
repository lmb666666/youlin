import { describe, it, expect, beforeEach } from 'vitest'
import { SELF } from 'cloudflare:test'
import Ajv2020 from 'ajv/dist/2020'
import { env } from './helpers'
import schema from '../schemas/api-circle.response.schema.json'
import example from '../schemas/examples/api-circle.example.json'

const ajv = new Ajv2020({ strict: false, allErrors: true })
const validate = ajv.compile(schema as object)

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM articles'),
    env.DB.prepare('DELETE FROM source_state'),
    env.DB.prepare('DELETE FROM friends'),
    env.DB.prepare('DELETE FROM groups'),
    env.DB.prepare('DELETE FROM settings'),
  ])
})

async function seed(): Promise<{ withFeed: number; noCircle: number; failed: number }> {
  const g = await env.DB.prepare('INSERT INTO groups (name) VALUES (?) RETURNING id').bind('圈').first<{ id: number }>()
  const withFeed = (
    await env.DB.prepare('INSERT INTO friends (group_id, author, link, feed, avatar, in_circle, since) VALUES (?, ?, ?, ?, ?, 1, ?) RETURNING id')
      .bind(g!.id, '甲', 'https://jia.example.com/', 'https://jia.example.com/feed.xml', 'https://jia.example.com/a.png', '2026-01-01')
      .first<{ id: number }>()
  )!.id
  const failed = (
    await env.DB.prepare('INSERT INTO friends (group_id, author, link, feed, in_circle, since) VALUES (?, ?, ?, ?, 1, ?) RETURNING id')
      .bind(g!.id, '乙', 'https://yi.example.com/', 'https://yi.example.com/feed.xml', '2026-01-01')
      .first<{ id: number }>()
  )!.id
  const noCircle = (
    await env.DB.prepare('INSERT INTO friends (group_id, author, link, feed, in_circle, since) VALUES (?, ?, ?, ?, 0, ?) RETURNING id')
      .bind(g!.id, '丙', 'https://bing.example.com/', 'https://bing.example.com/feed.xml', '2026-01-01')
      .first<{ id: number }>()
  )!.id

  await env.DB.batch([
    // 甲：两篇文章（含未来容差内的时间不设；fetched_at 覆盖 updatedAt）
    env.DB.prepare("INSERT INTO articles (friend_id, guid, title, link, author, published_at, fetched_at) VALUES (?, 'j1', '甲一', 'https://jia.example.com/1', '甲', '2026-10-01T10:00:00Z', '2026-10-05T08:00:00')").bind(withFeed),
    env.DB.prepare("INSERT INTO articles (friend_id, guid, title, link, author, published_at, fetched_at) VALUES (?, 'j2', '甲二', 'https://jia.example.com/2', '甲', '2026-10-03T10:00:00Z', '2026-10-05T09:30:00')").bind(withFeed),
    // 丙：in_circle=0 → 不进朋友圈输出与统计
    env.DB.prepare("INSERT INTO articles (friend_id, guid, title, link, author, published_at) VALUES (?, 'b1', '丙不出现', 'https://bing.example.com/1', '丙', '2026-10-04T10:00:00Z')").bind(noCircle),
    // 甲：crawlable=1；乙：reachable=0（抓取失败）
    env.DB.prepare("INSERT INTO source_state (friend_id, reachable, crawlable, best_method, checked_at) VALUES (?, 1, 1, 'rss', datetime('now'))").bind(withFeed),
    env.DB.prepare("INSERT INTO source_state (friend_id, reachable, crawlable, best_method, checked_at) VALUES (?, 0, 0, 'none', datetime('now'))").bind(failed),
  ])
  return { withFeed, noCircle, failed }
}

describe('接口二 GET /api/circle 契约', () => {
  it('空库：stats 全零、articles 空、updatedAt null、过 schema', async () => {
    const res = await SELF.fetch('https://example.com/api/circle')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    const body = (await res.json()) as unknown
    expect(validate(body)).toBe(true)
    expect(body).toEqual({
      stats: { friends: 0, active: 0, failed: 0, articles: 0, updatedAt: null },
      articles: [],
    })
  })

  it('统计口径（参与全集）与输出排序；in_circle=0 排除', async () => {
    await seed()
    const res = await SELF.fetch('https://example.com/api/circle')
    const body = (await res.json()) as {
      stats: { friends: number; active: number; failed: number; articles: number; updatedAt: string | null }
      articles: { title: string; link: string; author?: string; avatar?: string; publishedAt: string }[]
    }
    expect(validate(body)).toBe(true)

    expect(body.stats.friends).toBe(2) // 甲、乙（参与朋友圈 = feed 可用）
    expect(body.stats.failed).toBe(1) // 乙（reachable=0）
    expect(body.stats.active).toBe(1) // 甲有文章
    expect(body.stats.articles).toBe(2) // 丙的两篇不计
    expect(body.stats.updatedAt).toBe('2026-10-05T09:30:00Z')

    expect(body.articles).toHaveLength(2)
    expect(body.articles[0]!.title).toBe('甲二') // publishedAt 倒序
    expect(body.articles[0]!.publishedAt).toBe('2026-10-03T10:00:00Z')
    expect(body.articles[1]!.avatar).toBe('https://jia.example.com/a.png')
    expect(body.articles.map((a) => a.title)).not.toContain('丙不出现')
  })

  it('?limit= 截断且受 outputMaxArticles/maxLimit 上限约束', async () => {
    await seed()
    const one = (await (await SELF.fetch('https://example.com/api/circle?limit=1')).json()) as { articles: unknown[] }
    expect(validate(one)).toBe(true)
    expect(one.articles).toHaveLength(1)

    const over = (await (await SELF.fetch('https://example.com/api/circle?limit=99999')).json()) as { articles: unknown[] }
    expect(validate(over)).toBe(true)
    expect(over.articles).toHaveLength(2) // 全集只有 2 篇，且 ≤ 上限
  })

  it('契约示例文件本身通过 schema', () => {
    expect(validate(example)).toBe(true)
  })
})
