import { CloudDownload, CloudUpload, PlugZap, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { BackupStatusResponse, DavFile } from '@youlin/contracts'
import type { DateTimeOptions } from '@/lib/format'
import { fmtBackupName, fmtBytes } from './format'

export function WebdavCard(props: {
  status: BackupStatusResponse | undefined
  files: DavFile[] | undefined
  error: string | null
  statusError: string | null
  onRetryStatus: () => void
  busy: string | null
  cloudTarget: string | null
  dtOpts: DateTimeOptions
  onTest: () => void
  onRun: () => void
  onRefresh: () => void
  onCloudTargetChange: (name: string | null) => void
  onRestore: (name: string) => void
}) {
  const { status, files, error, statusError, onRetryStatus, busy, cloudTarget, dtOpts, onTest, onRun, onRefresh, onCloudTargetChange, onRestore } = props
  const configured = status?.webdav.configured ?? false
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CloudUpload className="size-4" /> WebDAV
        </CardTitle>
        <CardDescription>地址、用户名与周期在设置页配置；密码写在 Secret（WEBDAV_PASSWORD）。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {statusError ? (
          <div className="grid gap-2">
            <p className="text-muted-foreground">读取备份状态失败：{statusError}</p>
            <Button variant="outline" size="sm" className="w-fit" onClick={onRetryStatus}>重试</Button>
          </div>
        ) : !status ? (
          <p className="text-muted-foreground">读取中…</p>
        ) : configured ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">已配置</Badge>
              <span className="break-all text-xs text-muted-foreground">{status.webdav.url}{status.webdav.path ? ` · ${status.webdav.path}` : ''}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onTest} disabled={busy !== null}>
                <PlugZap /> {busy === 'dav-test' ? '检测中…' : '测试连接'}
              </Button>
              <Button onClick={onRun} disabled={busy !== null}>
                <CloudUpload /> {busy === 'dav-run' ? '上传中…' : '立即备份到 WebDAV'}
              </Button>
              <Button variant="ghost" onClick={onRefresh} disabled={busy !== null}>
                <RefreshCw /> 刷新列表
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {files && files.length > 0 && (
              <div className="grid gap-1 rounded-md border p-2">
                {files.map((f) => (
                  <div key={f.name} className="flex flex-wrap items-center justify-between gap-2 rounded px-1 py-1 text-xs">
                    <span className="min-w-0 truncate">{fmtBackupName(f.name, dtOpts)}</span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      {fmtBytes(f.size)}
                      <AlertDialog open={cloudTarget === f.name} onOpenChange={(o) => onCloudTargetChange(o ? f.name : null)}>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={busy !== null}>
                            <CloudDownload /> 恢复
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>从这个云端备份恢复？</AlertDialogTitle>
                            <AlertDialogDescription>
                              会先把当前数据自动存档一份到 WebDAV，再清空并写入 {fmtBackupName(f.name, dtOpts)}。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-white hover:bg-destructive/90"
                              onClick={() => onRestore(f.name)}
                              disabled={busy !== null}
                            >
                              {busy === 'dav-restore' ? '恢复中…' : '确认恢复'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {files && files.length === 0 && <p className="text-xs text-muted-foreground">云端还没有备份文件。</p>}
          </>
        ) : (
          <p className="text-muted-foreground">尚未配置。到设置页填写 WebDAV 地址与用户名，并设置 WEBDAV_PASSWORD。</p>
        )}
        <Separator className="my-1" />
        <p className="text-xs text-muted-foreground">
          自动备份与云端恢复在开启 WebDAV 后可用；同一目录保留最近 {status?.backup.retain ?? 7} 份，
          恢复前存档保留 30 天，在下次 WebDAV 备份时清理。
        </p>
      </CardContent>
    </Card>
  )
}
