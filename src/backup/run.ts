import type { AppConfig, Env } from '../types'
import { runtimeGet, runtimeSet } from '../crawler/http'
import { collectBackup } from './collect'
import { gzipBytes } from './codec'
import { backupFileName } from './format'
import { recordBackupStatus, type BackupStatus } from './status'
import { WebDavError, webdavClientFor, webdavReady } from './webdav'

/**
 * WebDAV 备份执行与调度
 *
 * 自动备份按 backup.schedule 的最小间隔检查（同一份状态里记下最近一次尝试时间，
 * 失败也记，避免 5 分钟 tick 反复重试打爆 WebDAV）。
 */

const SCHEDULE_MS: Record<AppConfig['backup']['schedule'], number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
}

const LAST_ATTEMPT_KEY = 'internal.lastWebdavAttempt'

export interface WebdavRunResult {
  ok: boolean
  status: BackupStatus
  pruned?: number
  error?: string
}

function preRestoreName(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}-` +
    `${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}`
  return `pre-restore-${stamp}.json.gz`
}

export async function runWebdavBackup(
  db: Env['DB'],
  env: Env,
  cfg: AppConfig,
  opts: { target: 'webdav' | 'pre-restore'; includeArticles: boolean },
): Promise<WebdavRunResult> {
  const at = new Date().toISOString()
  try {
    const client = webdavClientFor(cfg, env.WEBDAV_PASSWORD)
    const envelope = await collectBackup(db, env, { includeArticles: opts.includeArticles })
    const gz = await gzipBytes(new TextEncoder().encode(JSON.stringify(envelope)))
    const name = opts.target === 'pre-restore' ? preRestoreName() : backupFileName()
    await client.ensureDir()
    await client.put(name, gz)
    const pruned = opts.target === 'webdav' ? await client.prune(cfg.backup.retain) : 0
    const status: BackupStatus = { at, ok: true, target: opts.target, bytes: gz.byteLength, file: name }
    await recordBackupStatus(db, status)
    await runtimeSet(db, LAST_ATTEMPT_KEY, { at, ok: true })
    return { ok: true, status, pruned }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status: BackupStatus = { at, ok: false, target: opts.target, error: message }
    await recordBackupStatus(db, status)
    await runtimeSet(db, LAST_ATTEMPT_KEY, { at, ok: false })
    if (err instanceof WebDavError && err.status === 401) {
      return { ok: false, status, error: '认证失败，请检查用户名与 WEBDAV_PASSWORD' }
    }
    return { ok: false, status, error: message }
  }
}

/** 自动备份：按周期到点才执行；未配置或未开启时返回 null */
export async function maybeRunScheduledBackup(
  db: Env['DB'],
  env: Env,
  cfg: AppConfig,
): Promise<WebdavRunResult | null> {
  if (!cfg.backup.enabled || !webdavReady(cfg, env.WEBDAV_PASSWORD)) return null
  const last = (await runtimeGet(db, LAST_ATTEMPT_KEY)) as { at?: string } | null
  const lastAt = last?.at ? Date.parse(last.at) : 0
  if (Number.isFinite(lastAt) && lastAt > 0 && Date.now() - lastAt < SCHEDULE_MS[cfg.backup.schedule]) {
    return null
  }
  return await runWebdavBackup(db, env, cfg, {
    target: 'webdav',
    includeArticles: cfg.backup.includeArticles,
  })
}
