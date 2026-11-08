import { Download, HardDriveDownload, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { StatusBadge } from '@/components/common/status-badge'
import type { BackupStatusResponse } from '@youlin/contracts'
import { formatBytes, formatDateTime, type DateTimeOptions } from '@/lib/format'
import { TARGET_LABEL } from './format'

export function BackupNowCard({
  status,
  includeArticles,
  pending,
  dtOpts,
  onToggleArticles,
  onDownload,
}: {
  status: BackupStatusResponse | undefined
  includeArticles: boolean
  pending: boolean
  dtOpts: DateTimeOptions
  onToggleArticles: (value: boolean) => void
  onDownload: () => void
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDriveDownload className="size-4 text-primary" /> 立即备份
        </CardTitle>
        <CardDescription>生成 .json.gz 文件并下载到本机；也可以在设置里开启自动上传 WebDAV。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <div>
            <p className="text-sm">本次备份包含文章与体检状态</p>
            <p className="mt-0.5 text-[11px] text-subtle">文章可以重新抓取，默认不备以减小体积。</p>
          </div>
          <Switch checked={includeArticles} onCheckedChange={onToggleArticles} aria-label="本次备份包含文章与体检状态" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onDownload} disabled={pending}>
            <Download /> {pending ? '打包中…' : '下载备份文件'}
          </Button>
          {status && (
            <span className="text-xs text-subtle">
              自动备份：{status.backup.enabled ? `已开启（${status.backup.schedule}）` : '未开启'}
            </span>
          )}
        </div>
        {status?.last && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            <History className="size-3.5 shrink-0" />
            <span>最近一次：{formatDateTime(status.last.at, dtOpts)}</span>
            <StatusBadge tone={status.last.ok ? 'success' : 'danger'}>{TARGET_LABEL[status.last.target]}</StatusBadge>
            <span>{status.last.ok ? `成功（${formatBytes(status.last.bytes)}）` : `失败：${status.last.error ?? '未知错误'}`}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
