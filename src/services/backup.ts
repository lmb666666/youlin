import { AppError } from '../errors'
import { runtimeGet, runtimeSet } from '../crawler/http'
import { collectBackup } from '../backup/collect'
import { BACKUP_MAX_BYTES, decodeBackup, gzipBytes } from '../backup/codec'
import { backupFileName, type BackupEnvelope } from '../backup/format'
import { applyRestore, type RestoreSummary } from '../backup/restore'
import { invalidateConfigCache } from '../config/loader'
import { readBackupStatus, recordBackupStatus } from '../backup/status'
import { runWebdavBackup } from '../backup/run'
import { BACKUP_FILE_PATTERN, WebDavError, redactWebdavUrl, webdavClientFor, webdavReady } from '../backup/webdav'
import type { AppConfig, Db, Env } from '../types'
import type { BackupPreview } from '@youlin/contracts'

/** 未配 WebDAV 时，恢复凭证的有效期（export 时签发，防「从未备份就恢复」） */
const PREBACKUP_WINDOW_MS = 3_600_000
const PREBACKUP_TICKET_KEY = 'internal.prebackupAt'

export interface BackupArchive {
  bytes: Uint8Array
  name: string
}

export interface RestoreResult {
  summary: RestoreSummary
  preRestoreFile: string | null
}

function webdavError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  const status = err instanceof WebDavError && err.status >= 400 && err.status < 600 ? 502 : 500
  throw new AppError(status, 'webdav_failed', message)
}

function assertWebdavReady(cfg: AppConfig, env: Env): void {
  if (!webdavReady(cfg, env.WEBDAV_PASSWORD)) {
    throw new AppError(400, 'webdav_not_configured', 'WebDAV 未配置：请填写地址与用户名，并设置 WEBDAV_PASSWORD')
  }
}

/** 下载备份：同时签发恢复凭证并记录最近一次备份状态 */
export async function createBackupArchive(db: Db, env: Env, includeArticles: boolean): Promise<BackupArchive> {
  const envelope = await collectBackup(db, env, { includeArticles })
  const bytes = await gzipBytes(new TextEncoder().encode(JSON.stringify(envelope)))
  const name = backupFileName()
  await runtimeSet(db, PREBACKUP_TICKET_KEY, new Date().toISOString())
  await recordBackupStatus(db, {
    at: new Date().toISOString(),
    ok: true,
    target: 'download',
    bytes: bytes.byteLength,
    file: name,
  })
  return { bytes, name }
}

export async function previewBackup(bytes: Uint8Array): Promise<BackupPreview> {
  const e = await decodeBackup(bytes)
  return {
    version: e.version,
    exportedAt: e.exportedAt,
    appVersion: e.app?.version ?? null,
    counts: {
      groups: e.data.groups.length,
      friends: e.data.friends.length,
      applications: e.data.applications.length,
      articles: e.data.articles?.length ?? 0,
      settings: Object.keys(e.data.settings).length,
    },
    includeArticles: e.data.articles !== undefined,
  }
}

/**
 * 恢复前的留存证明：配了 WebDAV 就自动存档（失败不动数据），
 * 否则要求 1 小时内下载过备份。
 */
async function prepareRestore(db: Db, env: Env, cfg: AppConfig): Promise<string | null> {
  if (webdavReady(cfg, env.WEBDAV_PASSWORD)) {
    // 存档恒含文章——wipe 会无条件清空 articles，按待恢复文件的范围存档会让回滚丢文章
    const pre = await runWebdavBackup(db, env, cfg, { target: 'pre-restore', includeArticles: true })
    if (!pre.ok) {
      throw new AppError(
        502,
        'prebackup_failed',
        `恢复前的自动存档失败：${pre.error ?? '未知错误'}。请先下载当前数据，或到设置中清空 WebDAV 地址后重试`,
      )
    }
    return pre.status.file ?? null
  }

  const ticket = await runtimeGet(db, PREBACKUP_TICKET_KEY)
  const ticketAt = typeof ticket === 'string' ? Date.parse(ticket) : NaN
  if (!Number.isFinite(ticketAt) || Date.now() - ticketAt > PREBACKUP_WINDOW_MS) {
    throw new AppError(400, 'prebackup_required', '请先在备份页下载一份当前数据的备份（1 小时内），再执行恢复')
  }
  return null
}

async function restoreEnvelope(db: Db, env: Env, cfg: AppConfig, envelope: BackupEnvelope): Promise<RestoreResult> {
  const preRestoreFile = await prepareRestore(db, env, cfg)
  const summary = await applyRestore(db, envelope)
  invalidateConfigCache()
  return { summary, preRestoreFile }
}

export async function restoreFromFile(
  db: Db,
  env: Env,
  cfg: AppConfig,
  bytes: Uint8Array,
): Promise<RestoreResult> {
  return restoreEnvelope(db, env, cfg, await decodeBackup(bytes))
}

export async function restoreFromWebdav(
  db: Db,
  env: Env,
  cfg: AppConfig,
  name: string,
): Promise<RestoreResult> {
  if (!BACKUP_FILE_PATTERN.test(name)) throw new AppError(400, 'invalid_name', '备份文件名不合法')
  assertWebdavReady(cfg, env)

  let bytes: Uint8Array
  try {
    bytes = await webdavClientFor(cfg, env.WEBDAV_PASSWORD).get(name)
  } catch (err) {
    webdavError(err)
  }
  return restoreEnvelope(db, env, cfg, await decodeBackup(bytes))
}

export async function backupOverview(db: Db, env: Env, cfg: AppConfig) {
  const last = await readBackupStatus(db)
  return {
    last,
    backup: {
      enabled: cfg.backup.enabled,
      schedule: cfg.backup.schedule,
      includeArticles: cfg.backup.includeArticles,
      retain: cfg.backup.retain,
    },
    webdav: {
      configured: webdavReady(cfg, env.WEBDAV_PASSWORD),
      url: redactWebdavUrl(cfg.backup.webdavUrl),
      path: cfg.backup.webdavPath,
    },
  }
}

export async function testWebdavConnection(env: Env, cfg: AppConfig) {
  assertWebdavReady(cfg, env)
  try {
    return await webdavClientFor(cfg, env.WEBDAV_PASSWORD).test()
  } catch (err) {
    webdavError(err)
  }
}

export async function listWebdavFiles(env: Env, cfg: AppConfig) {
  assertWebdavReady(cfg, env)
  try {
    return await webdavClientFor(cfg, env.WEBDAV_PASSWORD).list()
  } catch (err) {
    webdavError(err)
  }
}

export async function runWebdavBackupNow(db: Db, env: Env, cfg: AppConfig) {
  assertWebdavReady(cfg, env)
  const result = await runWebdavBackup(db, env, cfg, {
    target: 'webdav',
    includeArticles: cfg.backup.includeArticles,
  })
  if (!result.ok) {
    throw new AppError(502, 'webdav_backup_failed', result.error ?? '备份失败', { status: result.status })
  }
  return result
}

export { BACKUP_MAX_BYTES }
