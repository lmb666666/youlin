import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArchiveRestore } from 'lucide-react'
import type { BackupPreview, DavRunResponse, DavTestResponse, RestoreResponse } from '@youlin/contracts'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState } from '@/components/common/page-state'
import { PageHeader } from '@/components/common/page-header'
import { api, apiDownload, apiUpload } from '@/lib/api'
import { downloadBlob } from '@/lib/download'
import { useBackupStatusQuery, useDavFilesQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { useSettings, useSettingsRefresh } from '@/lib/settings'
import { settingsDateTimeOptions } from '@/lib/format'
import { fmtBackupName } from './format'
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

  async function afterRestore(result: RestoreResponse) {
    const summary = result.summary
    const archived = result.preRestoreFile ? `；恢复前已存档 ${fmtBackupName(result.preRestoreFile, dtOpts)}` : ''
    toast.success(`恢复完成：${summary.groups} 个分组、${summary.friends} 条友链、${summary.applications} 条申请、${summary.settings} 项设置${archived}`)
    setFile(null)
    setPreview(null)
    setAck(false)
    setCloudTarget(null)
    refreshSettings()
    await client.invalidateQueries()
  }

  const download = useMutation({
    mutationFn: () => apiDownload(`/api/admin/backup/export?articles=${includeArticles ? 1 : 0}`),
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename ?? 'youlin-backup.json.gz')
      toast.success(`备份已下载（${(blob.size / 1024 / 1024).toFixed(1)} MB）`)
      void client.invalidateQueries({ queryKey: queryKeys.backupStatus })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '备份失败'),
  })

  const testDav = useMutation({
    mutationFn: () => api<DavTestResponse>('/api/admin/backup/webdav/test', { method: 'POST' }),
    onSuccess: (result) => {
      toast.success(`连接正常，目录中已有 ${result.files} 份备份`)
      void client.invalidateQueries({ queryKey: queryKeys.davFiles })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '连接失败'),
  })

  const runDav = useMutation({
    mutationFn: () => api<DavRunResponse>('/api/admin/backup/webdav/run', { method: 'POST' }),
    onSuccess: (result) => {
      const name = result.status.file ? fmtBackupName(result.status.file, dtOpts) : '备份'
      toast.success(
        `已上传 ${name}${result.status.bytes ? `（${(result.status.bytes / 1024 / 1024).toFixed(1)} MB）` : ''}${result.pruned > 0 ? `，清理 ${result.pruned} 份旧备份` : ''}`,
      )
      void client.invalidateQueries({ queryKey: queryKeys.backupStatus })
      void client.invalidateQueries({ queryKey: queryKeys.davFiles })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '上传失败')
      void client.invalidateQueries({ queryKey: queryKeys.backupStatus })
    },
  })

  const previewFile = useMutation({
    mutationFn: (picked: File) => apiUpload<{ summary: BackupPreview }>('/api/admin/backup/preview', picked),
    onSuccess: (result, picked) => {
      setFile(picked)
      setPreview(result.summary)
      setAck(false)
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '无法读取备份文件'),
  })

  const restoreFile = useMutation({
    mutationFn: (picked: File) => apiUpload<RestoreResponse>('/api/admin/backup/restore?confirm=1', picked),
    onSuccess: (result) => void afterRestore(result),
    onError: (error) => toast.error(error instanceof Error ? error.message : '恢复失败'),
  })

  const restoreCloud = useMutation({
    mutationFn: (name: string) =>
      api<RestoreResponse>('/api/admin/backup/webdav/restore?confirm=1', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (result) => void afterRestore(result),
    onError: (error) => {
      setCloudTarget(null)
      toast.error(error instanceof Error ? error.message : '恢复失败')
    },
  })

  const pendingAction = download.isPending
    ? 'download'
    : testDav.isPending
      ? 'dav-test'
      : runDav.isPending
        ? 'dav-run'
        : previewFile.isPending
          ? 'preview'
          : restoreFile.isPending
            ? 'restore'
            : restoreCloud.isPending
              ? 'dav-restore'
              : null

  if (statusQuery.isError && !status) {
    return (
      <div className="grid gap-5">
        <PageHeader title="备份与恢复" description="备份包含分组、友链、申请与全部设置。" />
        <ErrorState title="备份状态加载失败" error={statusQuery.error} onRetry={() => void statusQuery.refetch()} />
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-4xl gap-4">
      <PageHeader
        eyebrow="JSON 备份信封 · 自然键关联"
        title="备份与恢复"
        description="备份包含分组、友链、申请与全部设置；文章和体检状态是派生数据，默认不备份。"
      />

      <BackupNowCard
        status={status}
        includeArticles={includeArticles}
        pending={download.isPending}
        dtOpts={dtOpts}
        onToggleArticles={setIncludeArticles}
        onDownload={() => download.mutate()}
      />

      <WebdavCard
        status={status}
        files={davQuery.data?.files}
        loading={davQuery.isFetching}
        error={davQuery.error instanceof Error ? davQuery.error.message : null}
        statusError={statusQuery.error instanceof Error ? statusQuery.error.message : null}
        pendingAction={pendingAction}
        dtOpts={dtOpts}
        onRetryStatus={() => void statusQuery.refetch()}
        onTest={() => testDav.mutate()}
        onRun={() => runDav.mutate()}
        onRefresh={() => void davQuery.refetch()}
        onRestore={setCloudTarget}
      />

      <RestoreCard
        file={file}
        preview={preview}
        ack={ack}
        davConfigured={status?.webdav.configured ?? false}
        pending={previewFile.isPending || restoreFile.isPending}
        dtOpts={dtOpts}
        onPick={(picked) => previewFile.mutate(picked)}
        onAckChange={setAck}
        onRestore={() => file && restoreFile.mutate(file)}
      />

      <ConfirmDialog
        open={cloudTarget !== null}
        onOpenChange={(open) => !open && setCloudTarget(null)}
        title="从云端备份恢复？"
        description={
          cloudTarget
            ? `会先把当前数据自动存档一份到 WebDAV，再清空并写入 ${fmtBackupName(cloudTarget, dtOpts)}。恢复期间请勿关闭页面。`
            : null
        }
        confirmLabel="确认恢复"
        tone="danger"
        pending={restoreCloud.isPending}
        onConfirm={() => cloudTarget && restoreCloud.mutate(cloudTarget)}
      />

      <p className="flex items-center gap-1.5 pb-6 text-[11px] text-subtle">
        <ArchiveRestore className="size-3.5" />
        恢复是覆盖式的；同一份文件可以重复恢复，中途失败会整体回滚。
      </p>
    </div>
  )
}
