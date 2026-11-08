import { Link } from 'react-router'
import { CloudDownload, CloudUpload, PlugZap, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/common/status-badge'
import type { BackupStatusResponse, DavFile } from '@youlin/contracts'
import type { DateTimeOptions } from '@/lib/format'
import { formatBytes } from '@/lib/format'
import { fmtBackupName } from './format'

export function WebdavCard({
  status,
  files,
  loading,
  error,
  statusError,
  pendingAction,
  dtOpts,
  onRetryStatus,
  onTest,
  onRun,
  onRefresh,
  onRestore,
}: {
  status: BackupStatusResponse | undefined
  files: DavFile[] | undefined
  loading: boolean
  error: string | null
  statusError: string | null
  pendingAction: string | null
  dtOpts: DateTimeOptions
  onRetryStatus: () => void
  onTest: () => void
  onRun: () => void
  onRefresh: () => void
  onRestore: (name: string) => void
}) {
  const configured = status?.webdav.configured ?? false
  const busy = pendingAction !== null

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudUpload className="size-4 text-primary" /> WebDAV
        </CardTitle>
        <CardDescription>地址、用户名与周期在设置页配置；密码写在环境变量 WEBDAV_PASSWORD。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 text-sm">
        {statusError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger">
            <span>读取备份状态失败：{statusError}</span>
            <Button variant="ghost" size="sm" onClick={onRetryStatus}>重试</Button>
          </div>
        ) : !status ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : configured ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="success">已配置</StatusBadge>
              <span className="break-all font-mono text-[11px] text-muted-foreground">
                {status.webdav.url}{status.webdav.path ? ` · ${status.webdav.path}` : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onTest} disabled={busy}>
                <PlugZap /> {pendingAction === 'dav-test' ? '检测中…' : '测试连接'}
              </Button>
              <Button size="sm" onClick={onRun} disabled={busy}>
                <CloudUpload /> {pendingAction === 'dav-run' ? '上传中…' : '立即备份到 WebDAV'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onRefresh} disabled={busy || loading}>
                <RefreshCw className={loading ? 'animate-spin' : undefined} /> 刷新列表
              </Button>
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}

            {loading && !files ? (
              <Skeleton className="h-16 rounded-lg" />
            ) : files && files.length > 0 ? (
              <div className="divide-y rounded-lg border">
                {files.map((file) => (
                  <div key={file.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="truncate">{fmtBackupName(file.name, dtOpts)}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-subtle">{file.name}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <span>{formatBytes(file.size)}</span>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => onRestore(file.name)}>
                        <CloudDownload /> 恢复
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-subtle">云端还没有备份文件。</p>
            )}
          </>
        ) : (
          <div className="rounded-lg border bg-secondary/40 px-3 py-3 text-xs text-muted-foreground">
            <p>尚未配置。到<Link to="/admin/settings?section=backup" className="mx-1 text-primary hover:underline">设置 → 备份</Link>填写 WebDAV 地址与用户名，并设置 WEBDAV_PASSWORD。</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
