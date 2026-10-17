import { Hono, type Context } from 'hono'
import { jsonError } from '../../util/http'
import type { AppEnv } from '../../types'
import { collectBackup } from '../../backup/collect'
import { BACKUP_MAX_BYTES, decodeBackup, gzipBytes } from '../../backup/codec'
import { backupFileName } from '../../backup/format'
import { applyRestore } from '../../backup/restore'
import { readBackupStatus, recordBackupStatus } from '../../backup/status'

/**
 * 备份与恢复（管理台「备份」页）
 *   GET  /api/admin/backup/export?articles=0|1   下载 .json.gz
 *   POST /api/admin/backup/preview               上传文件 → 摘要（确认对话框用）
 *   POST /api/admin/backup/restore?confirm=1&downloaded=1  覆盖式恢复
 *   GET  /api/admin/backup/status                最近一次备份结果
 */

async function readRawBody(c: Context<AppEnv>): Promise<Uint8Array | Response> {
  const declared = Number(c.req.header('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > BACKUP_MAX_BYTES) {
    return jsonError(413, 'file_too_large', `备份文件超过 ${BACKUP_MAX_BYTES / 1024 / 1024} MB`)
  }
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > BACKUP_MAX_BYTES) {
    return jsonError(413, 'file_too_large', `备份文件超过 ${BACKUP_MAX_BYTES / 1024 / 1024} MB`)
  }
  if (buf.byteLength === 0) return jsonError(400, 'empty_file', '请选择备份文件')
  return new Uint8Array(buf)
}

export function backupRoutes() {
  const app = new Hono<AppEnv>()

  app.get('/api/admin/backup/export', async (c) => {
    const includeArticles = c.req.query('articles') === '1'
    const envelope = await collectBackup(c.env.DB, c.env, { includeArticles })
    const gz = await gzipBytes(new TextEncoder().encode(JSON.stringify(envelope)))
    const name = backupFileName()
    await recordBackupStatus(c.env.DB, {
      at: new Date().toISOString(),
      ok: true,
      target: 'download',
      bytes: gz.byteLength,
      file: name,
    })
    return new Response(gz, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  })

  app.post('/api/admin/backup/preview', async (c) => {
    const body = await readRawBody(c)
    if (body instanceof Response) return body
    const decoded = await decodeBackup(body)
    if (!decoded.ok) return decoded.response
    const e = decoded.envelope
    return c.json({
      summary: {
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
      },
    })
  })

  app.post('/api/admin/backup/restore', async (c) => {
    if (c.req.query('confirm') !== '1') {
      return jsonError(400, 'confirm_required', '恢复会覆盖现有数据，请先确认')
    }
    const body = await readRawBody(c)
    if (body instanceof Response) return body
    const decoded = await decodeBackup(body)
    if (!decoded.ok) return decoded.response

    // 恢复前必须留存当前数据：配了 WebDAV 时由服务端自动备份（阶段 2），否则要求先下载
    const cfg = c.get('cfg')
    const webdavReady = Boolean(cfg.backup.webdavUrl.trim() && cfg.backup.webdavUsername.trim() && c.env.WEBDAV_PASSWORD)
    if (!webdavReady && c.req.query('downloaded') !== '1') {
      return jsonError(400, 'prebackup_required', '请先下载当前数据备份，再执行恢复')
    }

    const outcome = await applyRestore(c.env.DB, decoded.envelope)
    if (!outcome.ok) return outcome.response
    return c.json({ ok: true, summary: outcome.summary })
  })

  app.get('/api/admin/backup/status', async (c) => {
    const cfg = c.get('cfg')
    const last = await readBackupStatus(c.env.DB)
    return c.json({
      last,
      backup: {
        enabled: cfg.backup.enabled,
        schedule: cfg.backup.schedule,
        includeArticles: cfg.backup.includeArticles,
        retain: cfg.backup.retain,
      },
      webdav: {
        configured: Boolean(cfg.backup.webdavUrl.trim() && cfg.backup.webdavUsername.trim() && c.env.WEBDAV_PASSWORD),
        url: cfg.backup.webdavUrl,
        path: cfg.backup.webdavPath,
      },
    })
  })

  return app
}
