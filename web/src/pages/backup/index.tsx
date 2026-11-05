import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { BackupPreview, RestoreResponse } from '@youlin/contracts'
import { api, readError } from '@/lib/api'
import { downloadBlob } from '@/lib/download'
import { useBackupStatusQuery, useDavFilesQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { useQueryErrorToast } from '@/lib/query-error'
import { useSettings, useSettingsRefresh } from '@/lib/settings'
import { settingsDateTimeOptions } from '@/lib/format'
import { fmtBackupName, fmtBytes } from './format'
import { BackupNowCard } from './backup-now-card'
import { WebdavCard } from './webdav-card'
import { RestoreCard } from './restore-card'

export default function BackupPage() {
  const client = useQueryClient()
  const refreshSettings = useSettingsRefresh()
  const settings = useSettings()
  const dtOpts = settingsDateTimeOptions(settings)
  const statusQuery = useBackupStatusQuery()
  const status = statusQuery.data
  const davQuery = useDavFilesQuery(status?.webdav.configured ?? false)
  useQueryErrorToast(statusQuery.error)

  const [busy, setBusy] = useState<string | null>(null)
  const [includeArticles, setIncludeArticles] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [ack, setAck] = useState(false)
  const [cloudTarget, setCloudTarget] = useState<string | null>(null)
  const hydrated = useRef(false)

  useEffect(() => {
    if (status && !hydrated.current) {
      setIncludeArticles(status.backup.includeArticles)
      hydrated.current = true
    }
  }, [status])

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/backup/export?articles=${includeArticles ? 1 : 0}`)
      if (res.status === 401) {
        window.location.assign('/admin/login')
        throw new Error('未登录')
      }
      if (!res.ok) throw new Error(await readError(res))
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') ?? ''
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'youlin-backup.json.gz'
      return { blob, name }
    },
    onMutate: () => setBusy('download'),
    onSettled: () => setBusy(null),
    onSuccess: ({ blob, name }) => {
      downloadBlob(blob, name)
      toast.success(`备份已下载（${fmtBytes(blob.size)}）`)
      void client.invalidateQueries({ queryKey: queryKeys.backupStatus })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '备份失败'),
  })

  const testDavMutation = useMutation({
    mutationFn: () => api<{ ok: boolean; files: number }>('/api/admin/backup/webdav/test', { method: 'POST' }),
    onMutate: () => setBusy('dav-test'),
    onSettled: () => setBusy(null),
    onSuccess: (res) => {
      toast.success(`连接正常，目录中已有 ${res.files} 份备份`)
      void client.invalidateQueries({ queryKey: queryKeys.davFiles })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '连接失败'),
  })

  const runDavMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; status: { file: string; bytes?: number }; pruned: number }>(
        '/api/admin/backup/webdav/run',
        { method: 'POST' },
      ),
    onMutate: () => setBusy('dav-run'),
    onSettled: () => setBusy(null),
    onSuccess: (res) => {
      toast.success(`已上传 ${res.status.file}（${fmtBytes(res.status.bytes)}${res.pruned > 0 ? `，清理 ${res.pruned} 份旧备份` : ''}）`)
      void client.invalidateQueries({ queryKey: queryKeys.backupStatus })
      void client.invalidateQueries({ queryKey: queryKeys.davFiles })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : '上传失败')
      void client.invalidateQueries({ queryKey: queryKeys.backupStatus })
    },
  })

  const restoreCloudMutation = useMutation({
    mutationFn: (name: string) =>
      api<RestoreResponse>('/api/admin/backup/webdav/restore?confirm=1', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onMutate: () => {
      setBusy('dav-restore')
      setCloudTarget(null)
    },
    onSettled: () => setBusy(null),
    onSuccess: (res) => {
      const s = res.summary
      const archived = res.preRestoreFile ? `；恢复前已存档 ${fmtBackupName(res.preRestoreFile, dtOpts)}` : ''
      toast.success(`恢复完成：${s.groups} 个分组、${s.friends} 条友链、${s.applications} 条申请、${s.settings} 项设置${archived}`)
      refreshSettings()
      window.setTimeout(() => window.location.reload(), 900)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '恢复失败'),
  })

  const previewMutation = useMutation({
    mutationFn: async (picked: File) => {
      if (picked.size > 16 * 1024 * 1024) throw new Error('备份文件超过 16 MB')
      const res = await fetch('/api/admin/backup/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: picked,
      })
      if (res.status === 401) {
        window.location.assign('/admin/login')
        throw new Error('未登录')
      }
      const body = (await res.json()) as { summary?: BackupPreview; error?: { message?: string } }
      if (!res.ok || !body.summary) throw new Error(body.error?.message ?? '无法读取备份文件')
      return { picked, summary: body.summary }
    },
    onMutate: () => {
      setBusy('preview')
      setFile(null)
      setPreview(null)
      setAck(false)
    },
    onSettled: () => setBusy(null),
    onSuccess: ({ picked, summary }) => {
      setFile(picked)
      setPreview(summary)
      toast.success(`已读取 ${picked.name}`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '无法读取备份文件'),
  })

  const restoreMutation = useMutation({
    mutationFn: async (picked: File) => {
      // 未配 WebDAV 时服务端以「1 小时内导出过」为凭证（下载备份已签发），无需客户端自证
      const res = await fetch('/api/admin/backup/restore?confirm=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: picked,
      })
      if (res.status === 401) {
        window.location.assign('/admin/login')
        throw new Error('未登录')
      }
      const body = (await res.json()) as RestoreResponse & { error?: { message?: string } }
      if (!res.ok || !body.ok) throw new Error(body.error?.message ?? '恢复失败')
      return body
    },
    onMutate: () => setBusy('restore'),
    onSettled: () => setBusy(null),
    onSuccess: (body) => {
      const s = body.summary
      const archived = body.preRestoreFile ? `；恢复前已存档 ${fmtBackupName(body.preRestoreFile, dtOpts)}` : ''
      toast.success(`恢复完成：${s.groups} 个分组、${s.friends} 条友链、${s.applications} 条申请、${s.settings} 项设置${archived}`)
      refreshSettings()
      setFile(null)
      setPreview(null)
      setAck(false)
      void client.invalidateQueries({ queryKey: queryKeys.backupStatus })
      window.setTimeout(() => window.location.reload(), 900)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '恢复失败'),
  })

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 [&>*]:min-w-0">
      <div>
        <h1 className="text-lg font-semibold">备份与恢复</h1>
        <p className="text-sm text-muted-foreground">
          备份包含分组、友链、申请与全部设置。文章和体检状态是派生数据，默认不备份。
        </p>
      </div>

      <BackupNowCard
        status={status}
        includeArticles={includeArticles}
        busy={busy !== null}
        dtOpts={dtOpts}
        onToggleArticles={setIncludeArticles}
        onDownload={() => downloadMutation.mutate()}
      />

      <WebdavCard
        status={status}
        files={davQuery.data?.files}
        error={davQuery.error instanceof Error ? davQuery.error.message : null}
        statusError={statusQuery.error instanceof Error ? statusQuery.error.message : null}
        onRetryStatus={() => void statusQuery.refetch()}
        busy={busy}
        cloudTarget={cloudTarget}
        dtOpts={dtOpts}
        onTest={() => testDavMutation.mutate()}
        onRun={() => runDavMutation.mutate()}
        onRefresh={() => void davQuery.refetch()}
        onCloudTargetChange={setCloudTarget}
        onRestore={(name) => restoreCloudMutation.mutate(name)}
      />

      <RestoreCard
        file={file}
        preview={preview}
        ack={ack}
        davConfigured={status?.webdav.configured ?? false}
        busy={busy}
        dtOpts={dtOpts}
        onPick={(picked) => previewMutation.mutate(picked)}
        onAckChange={setAck}
        onRestore={() => file && restoreMutation.mutate(file)}
      />
    </div>
  )
}
