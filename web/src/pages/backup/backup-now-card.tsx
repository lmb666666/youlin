import { Download, HardDriveDownload, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import type { BackupStatusResponse } from '@youlin/contracts'
import type { DateTimeOptions } from '@/lib/format'
import { fmtBytes, fmtTime, TARGET_LABEL } from './format'

export function BackupNowCard(props: {
  status: BackupStatusResponse | undefined
  includeArticles: boolean
  busy: boolean
  dtOpts: DateTimeOptions
  onToggleArticles: (value: boolean) => void
  onDownload: () => void
}) {
  const { status, includeArticles, busy, dtOpts, onToggleArticles, onDownload } = props
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDriveDownload className="size-4" /> 立即备份
        </CardTitle>
        <CardDescription>生成 .json.gz 文件并下载到本机；也可在设置里开启自动上传 WebDAV。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={includeArticles} onCheckedChange={onToggleArticles} />
          本次备份包含文章与体检状态
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onDownload} disabled={busy}>
            <Download /> {busy ? '打包中…' : '下载备份文件'}
          </Button>
          {status && (
            <span className="text-xs text-muted-foreground">
              自动备份：{status.backup.enabled ? `已开启（${status.backup.schedule}）` : '未开启'}
            </span>
          )}
        </div>
        {status?.last && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <History className="size-3.5" />
            <span>最近一次：{fmtTime(status.last.at, dtOpts)}</span>
            <Badge variant="outline">{TARGET_LABEL[status.last.target]}</Badge>
            <span>{status.last.ok ? `成功（${fmtBytes(status.last.bytes)}）` : `失败：${status.last.error ?? '未知错误'}`}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
