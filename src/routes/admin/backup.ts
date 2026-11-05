import { Hono, type Context } from 'hono'
import { AppError } from '../../errors'
import { readJsonOrThrow } from '../../util/http'
import {
  BACKUP_MAX_BYTES,
  backupOverview,
  createBackupArchive,
  listWebdavFiles,
  previewBackup,
  restoreFromFile,
  restoreFromWebdav,
  runWebdavBackupNow,
  testWebdavConnection,
} from '../../services/backup'
import type { AppEnv } from '../../types'

/**
 * 备份与恢复（管理台「备份」页）
 *   GET  /api/admin/backup/export?articles=0|1   下载 .json.gz（同时签发 1 小时内的恢复凭证）
 *   POST /api/admin/backup/preview               上传文件 → 摘要（确认对话框用）
 *   POST /api/admin/backup/restore?confirm=1     覆盖式恢复（配了 WebDAV 会先自动存档；
 *                                                未配 WebDAV 时要求 1 小时内下载过备份）
 *   GET  /api/admin/backup/status                最近一次备份结果
 *   POST /api/admin/backup/webdav/test           连接自检
 *   POST /api/admin/backup/webdav/run            立即上传一份
 *   GET  /api/admin/backup/webdav/list           列云端备份
 *   POST /api/admin/backup/webdav/restore        从云端文件恢复（同样先自动存档）
 */

async function readRawBody(c: Context<AppEnv>): Promise<Uint8Array> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > BACKUP_MAX_BYTES) {
    throw new AppError(413, 'file_too_large', `备份文件超过 ${BACKUP_MAX_BYTES / 1024 / 1024} MB`)
  }
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > BACKUP_MAX_BYTES) {
    throw new AppError(413, 'file_too_large', `备份文件超过 ${BACKUP_MAX_BYTES / 1024 / 1024} MB`)
  }
  if (buf.byteLength === 0) throw new AppError(400, 'empty_file', '请选择备份文件')
  return new Uint8Array(buf)
}

function requireConfirm(c: Context<AppEnv>): void {
  if (c.req.query('confirm') !== '1') {
    throw new AppError(400, 'confirm_required', '恢复会覆盖现有数据，请先确认')
  }
}

export function backupRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/backup/export', async (c) => {
    const archive = await createBackupArchive(c.env.DB, c.env, c.req.query('articles') === '1')
    return new Response(archive.bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${archive.name}"`,
        'Cache-Control': 'no-store',
      },
    })
  })

  app.post('/api/admin/backup/preview', async (c) => {
    const summary = await previewBackup(await readRawBody(c))
    return c.json({ summary })
  })

  app.post('/api/admin/backup/restore', async (c) => {
    requireConfirm(c)
    const result = await restoreFromFile(c.env.DB, c.env, c.get('cfg'), await readRawBody(c))
    return c.json({ ok: true, ...result })
  })

  app.get('/api/admin/backup/status', async (c) =>
    c.json(await backupOverview(c.env.DB, c.env, c.get('cfg'))),
  )

  app.post('/api/admin/backup/webdav/test', async (c) => {
    const result = await testWebdavConnection(c.env, c.get('cfg'))
    return c.json({ ok: true, ...result })
  })

  app.post('/api/admin/backup/webdav/run', async (c) => {
    const result = await runWebdavBackupNow(c.env.DB, c.env, c.get('cfg'))
    return c.json({ ok: true, status: result.status, pruned: result.pruned ?? 0 })
  })

  app.get('/api/admin/backup/webdav/list', async (c) => {
    const files = await listWebdavFiles(c.env, c.get('cfg'))
    return c.json({ files })
  })

  app.post('/api/admin/backup/webdav/restore', async (c) => {
    requireConfirm(c)
    const body = await readJsonOrThrow(c)
    const name = body !== null && typeof body === 'object' ? String((body as Record<string, unknown>).name ?? '') : ''
    const result = await restoreFromWebdav(c.env.DB, c.env, c.get('cfg'), name)
    return c.json({ ok: true, ...result })
  })

  return app
}
