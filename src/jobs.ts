import type { AppConfig, Env } from './types'
import { runCronTick, type CrawlSummary } from './crawler/crawl'
import { maybeRunScheduledBackup, type WebdavRunResult } from './backup/run'

/** 两个运行时共用的定时作业：抓取轮转 + 到点自动备份到 WebDAV */

export interface ScheduledSummary {
  crawl: CrawlSummary
  backup: WebdavRunResult | null
}

export async function runScheduledJobs(db: Env['DB'], env: Env, cfg: AppConfig): Promise<ScheduledSummary> {
  const crawl = await runCronTick(db, env, cfg)
  let backup: WebdavRunResult | null = null
  try {
    backup = await maybeRunScheduledBackup(db, env, cfg)
  } catch (err) {
    console.error('[backup] 自动备份异常:', err instanceof Error ? err.stack : err)
  }
  return { crawl, backup }
}
