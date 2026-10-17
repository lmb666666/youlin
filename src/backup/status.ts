import type { Env } from '../types'
import { runtimeGet, runtimeSet } from '../crawler/http'

/** 最近一次备份结果，写在 settings 表的 internal.lastBackup（随轮次状态同表） */

export type BackupTarget = 'download' | 'webdav' | 'pre-restore'

export interface BackupStatus {
  at: string
  ok: boolean
  target: BackupTarget
  bytes?: number
  file?: string
  error?: string
}

const KEY = 'internal.lastBackup'

function isStatus(v: unknown): v is BackupStatus {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.at === 'string' && typeof o.ok === 'boolean' && typeof o.target === 'string'
}

export async function readBackupStatus(db: Env['DB']): Promise<BackupStatus | null> {
  const raw = await runtimeGet(db, KEY)
  return isStatus(raw) ? raw : null
}

export async function recordBackupStatus(db: Env['DB'], status: BackupStatus): Promise<void> {
  await runtimeSet(db, KEY, status)
}
