import { Hono, type Context } from 'hono'
import { jsonError, readJson } from '../../util/http'
import type { AppEnv } from '../../types'
import { collectBackup } from '../../backup/collect'
import { BACKUP_MAX_BYTES, decodeBackup, gzipBytes } from '../../backup/codec'
import { backupFileName } from '../../backup/format'
import { applyRestore } from '../../backup/restore'
import { readBackupStatus, recordBackupStatus } from '../../backup/status'
import { runWebdavBackup } from '../../backup/run'
import { BACKUP_FILE_PATTERN, WebDavError, webdavClientFor, webdavReady } from '../../backup/webdav'

/**
 * 备份与恢复（管理台「备份」页）
 *   GET  /api/admin/backup/export?articles=0|1   下载 .json.gz
 *   POST /api/admin/backup/preview               上传文件 → 摘要（确认对话框用）
 *   POST /api/admin/backup/restore?confirm=1     覆盖式恢复（配了 WebDAV 会先自动存档）
 *   GET  /api/admin/backup/status                最近一次备份结果
 *   POST /api/admin/backup/webdav/test           连接自检
 *   POST /api/admin/backup/webdav/run            立即上传一份
 *   GET  /api/admin/backup/webdav/list           列云端备份
 *   POST /api/admin/backup/webdav/restore        从云端文件恢复（同样先自动存档）
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

function webdavErrorResponse(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err)
  const status = err instanceof WebDavError && err.status >= 400 && err.status < 600 ? 502 : 500
  return jsonError(status, 'webdav_failed', message)
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

    const cfg = c.get('cfg')
    const webdavConfigured = webdavReady(cfg, c.env.WEBDAV_PASSWORD)
    let preRestoreFile: string | null = null
    if (webdavConfigured) {
      // 恢复前自动留存：上传失败就不动现有数据
      const pre = await runWebdavBackup(c.env.DB, c.env, cfg, {
        target: 'pre-restore',
        includeArticles: decoded.envelope.data.articles !== undefined,
      })
      if (!pre.ok) {
        return jsonError(
          502,
          'prebackup_failed',
          `恢复前的自动存档失败：${pre.error ?? '未知错误'}。请先下载当前数据，或到设置中清空 WebDAV 地址后重试`,
        )
      }
      preRestoreFile = pre.status.file ?? null
    } else if (c.req.query('downloaded') !== '1') {
      return jsonError(400, 'prebackup_required', '请先下载当前数据备份，再执行恢复')
    }

    const outcome = await applyRestore(c.env.DB, decoded.envelope)
    if (!outcome.ok) return outcome.response
    return c.json({ ok: true, summary: outcome.summary, preRestoreFile })
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
        configured: webdavReady(cfg, c.env.WEBDAV_PASSWORD),
        url: cfg.backup.webdavUrl,
        path: cfg.backup.webdavPath,
      },
    })
  })

  app.post('/api/admin/backup/webdav/test', async (c) => {
    const cfg = c.get('cfg')
    if (!webdavReady(cfg, c.env.WEBDAV_PASSWORD)) {
      return jsonError(400, 'webdav_not_configured', 'WebDAV 未配置：请填写地址与用户名，并设置 WEBDAV_PASSWORD')
    }
    try {
      const client = webdavClientFor(cfg, c.env.WEBDAV_PASSWORD)
      const result = await client.test()
      return c.json({ ok: true, ...result })
    } catch (err) {
      return webdavErrorResponse(err)
    }
  })

  app.post('/api/admin/backup/webdav/run', async (c) => {
    const cfg = c.get('cfg')
    if (!webdavReady(cfg, c.env.WEBDAV_PASSWORD)) {
      return jsonError(400, 'webdav_not_configured', 'WebDAV 未配置：请填写地址与用户名，并设置 WEBDAV_PASSWORD')
    }
    const result = await runWebdavBackup(c.env.DB, c.env, cfg, {
      target: 'webdav',
      includeArticles: cfg.backup.includeArticles,
    })
    if (!result.ok) {
      return c.json(
        { error: { code: 'webdav_backup_failed', message: result.error ?? '备份失败' }, status: result.status },
        502,
      )
    }
    return c.json({ ok: true, status: result.status, pruned: result.pruned ?? 0 })
  })

  app.get('/api/admin/backup/webdav/list', async (c) => {
    const cfg = c.get('cfg')
    if (!webdavReady(cfg, c.env.WEBDAV_PASSWORD)) {
      return jsonError(400, 'webdav_not_configured', 'WebDAV 未配置：请填写地址与用户名，并设置 WEBDAV_PASSWORD')
    }
    try {
      const client = webdavClientFor(cfg, c.env.WEBDAV_PASSWORD)
      const files = await client.list()
      return c.json({ files })
    } catch (err) {
      return webdavErrorResponse(err)
    }
  })

  app.post('/api/admin/backup/webdav/restore', async (c) => {
    if (c.req.query('confirm') !== '1') {
      return jsonError(400, 'confirm_required', '恢复会覆盖现有数据，请先确认')
    }
    const cfg = c.get('cfg')
    const body = await readJson(c)
    const name = body !== null && typeof body === 'object' ? String((body as Record<string, unknown>).name ?? '') : ''
    if (!BACKUP_FILE_PATTERN.test(name)) return jsonError(400, 'invalid_name', '备份文件名不合法')

    let bytes: Uint8Array
    try {
      const client = webdavClientFor(cfg, c.env.WEBDAV_PASSWORD)
      bytes = await client.get(name)
    } catch (err) {
      return webdavErrorResponse(err)
    }
    const decoded = await decodeBackup(bytes)
    if (!decoded.ok) return decoded.response

    // 云端恢复同样先存档一份，再去覆盖
    const pre = await runWebdavBackup(c.env.DB, c.env, cfg, {
      target: 'pre-restore',
      includeArticles: decoded.envelope.data.articles !== undefined,
    })
    if (!pre.ok) {
      return jsonError(502, 'prebackup_failed', `恢复前的自动存档失败：${pre.error ?? '未知错误'}`)
    }

    const outcome = await applyRestore(c.env.DB, decoded.envelope)
    if (!outcome.ok) return outcome.response
    return c.json({ ok: true, summary: outcome.summary, preRestoreFile: pre.status.file ?? null })
  })

  return app
}
