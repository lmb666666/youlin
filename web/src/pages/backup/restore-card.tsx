import { useRef, useState } from 'react'
import { ArchiveRestore, ShieldAlert, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import type { BackupPreview } from '@youlin/contracts'
import type { DateTimeOptions } from '@/lib/format'
import { formatDateTime } from '@/lib/format'

export function RestoreCard({
  file,
  preview,
  ack,
  davConfigured,
  pending,
  dtOpts,
  onPick,
  onAckChange,
  onRestore,
}: {
  file: File | null
  preview: BackupPreview | null
  ack: boolean
  davConfigured: boolean
  pending: boolean
  dtOpts: DateTimeOptions
  onPick: (file: File) => void
  onAckChange: (ack: boolean) => void
  onRestore: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const canRestore = Boolean(file && preview && ack && !pending)

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <ArchiveRestore className="size-4 text-primary" /> 从文件恢复
        </CardTitle>
        <CardDescription>覆盖式恢复：会清空现有分组、友链、申请，并按备份写入设置。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={pending}>
            <Upload /> {pending ? '读取中…' : '选择备份文件'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.gz,application/gzip,application/json"
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0]
              event.target.value = ''
              if (picked) onPick(picked)
            }}
          />
          {file && <span className="max-w-full truncate text-xs text-subtle">{file.name}</span>}
        </div>

        {preview && (
          <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['分组', preview.counts.groups],
                ['友链', preview.counts.friends],
                ['申请', preview.counts.applications],
                ['设置', preview.counts.settings],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-secondary/50 px-3 py-2">
                  <p className="text-[10px] text-subtle">{label}</p>
                  <p className="mt-1 font-serif text-xl tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-subtle">
              导出于 {formatDateTime(preview.exportedAt, dtOpts)}
              {preview.appVersion ? ` · 来源版本 ${preview.appVersion}` : ''}
              {preview.includeArticles ? ` · 含 ${preview.counts.articles} 篇文章` : ' · 不含文章'}
            </p>

            {!davConfigured && (
              <div className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg p-3 text-[11px] text-warning">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>未配置 WebDAV，恢复前请先下载当前数据；下载备份会签发 1 小时有效的恢复凭证。</span>
              </div>
            )}

            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs">
              <span>
                {davConfigured
                  ? '确认覆盖现有内容（当前数据会先自动存档到 WebDAV）'
                  : '我已保存当前数据，确认用这个文件覆盖现有内容'}
              </span>
              <Switch checked={ack} onCheckedChange={onAckChange} aria-label="确认覆盖现有内容" />
            </label>

            <div className="flex justify-end">
              <Button variant="destructive" disabled={!canRestore} onClick={() => setConfirmOpen(true)}>
                <ArchiveRestore /> 开始恢复
              </Button>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="覆盖现有数据？"
          description="将清空当前的分组、友链、申请，并写入备份中的设置。此操作不可撤销。"
          confirmLabel="确认恢复"
          tone="danger"
          pending={pending}
          onConfirm={onRestore}
        />
      </CardContent>
    </Card>
  )
}
