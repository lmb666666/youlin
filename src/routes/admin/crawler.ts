import { Hono } from 'hono'
import { readJsonOrThrow } from '../../util/http'
import { parseId } from '../../services/validation'
import {
  crawlFriend,
  crawlStatus,
  deleteArticle,
  listArticlesView,
  listHealthView,
  probeFriend,
  probeInput,
  startCrawlRound,
  startHealthRound,
} from '../../services/crawler'
import type { AppEnv } from '../../types'

/**
 * 抓取/体检/文章的管理 API（DESIGN §5）：
 *   GET  /api/admin/health           体检列表（全字段 source_state）
 *   POST /api/admin/health/run       全量体检（三路 + 反链，后台并发）
 *   GET  /api/admin/articles         文章列表（可按源筛）
 *   DELETE /api/admin/articles/:id
 *   POST /api/admin/crawl            手动全量抓取一轮（后台并发）
 *   POST /api/admin/crawl/:friendId  单源手动抓取（同步）
 *   GET  /api/admin/crawl/status     轮转进度
 *   POST /api/admin/friends/:id/probe    自动探测（已保存的友链）
 *   POST /api/admin/friends/probe        自动探测（表单预保存：body { link, feed? }）
 */

export function crawlerRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/health', (c) => c.json(listHealthView(c.env.DB)))

  // 全量体检：后台跑，进度见 /crawl/status
  app.post('/api/admin/health/run', async (c) => {
    const started = await startHealthRound(c.env.DB, c.env, c.get('cfg'))
    return c.json({ started })
  })

  app.get('/api/admin/articles', (c) => {
    const friendId = Number(c.req.query('friendId'))
    const filter = Number.isInteger(friendId) && friendId > 0
    return c.json(listArticlesView(c.env.DB, filter ? friendId : undefined))
  })

  app.delete('/api/admin/articles/:id', (c) => {
    deleteArticle(c.env.DB, parseId(c.req.param('id')))
    return c.json({ ok: true })
  })

  // 手动全量抓取一轮（后台并发，进度见 /status）
  app.post('/api/admin/crawl', async (c) => {
    const started = await startCrawlRound(c.env.DB, c.env, c.get('cfg'))
    return c.json({ started })
  })

  // 单源手动抓取（同步执行，返回该源结果）
  app.post('/api/admin/crawl/:friendId', async (c) => {
    const outcome = await crawlFriend(c.env.DB, c.env, c.get('cfg'), parseId(c.req.param('friendId')))
    return c.json({ outcome })
  })

  app.get('/api/admin/crawl/status', async (c) => c.json(await crawlStatus(c.env.DB)))

  // 探测：表单预保存场景（body 直接给 link/feed，无需先存库）
  app.post('/api/admin/friends/probe', async (c) =>
    c.json({ probe: await probeInput(c.env, c.get('cfg'), await readJsonOrThrow(c)) }),
  )

  // 探测：已保存的友链（DESIGN §5）
  app.post('/api/admin/friends/:id/probe', async (c) =>
    c.json({ probe: await probeFriend(c.env, c.get('cfg'), c.env.DB, parseId(c.req.param('id'))) }),
  )

  return app
}
