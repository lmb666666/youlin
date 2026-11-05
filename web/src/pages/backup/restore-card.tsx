import { useRef, useState } from 'react'
import { ArchiveRestore, ShieldAlert, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { BackupPreview } from '@youlin/contracts'
import type { DateTimeOptions } from '@/lib/format'
import { fmtTime } from './format'

export function RestoreCard(props: {
  file: File | null
  preview: BackupPreview | null
  ack: boolean
  davConfigured: boolean
  busy: string | null
  dtOpts: DateTimeOptions
  onPick: (file: File) => void
  onAckChange: (ack: boolean) => void
  onRestore: () => void
}) {
  const { file, preview, ack, davConfigured, busy, dtOpts, onPick, onAckChange, onRestore } = props
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const canRestore = Boolean(file && preview && ack && !busy)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArchiveRestore className="size-4" /> 从文件恢复
        </CardTitle>
        <CardDescription>覆盖式恢复：会清空现有分组、友链、申请，并按备份写入设置。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            <Upload /> {busy === 'preview' ? '读取中…' : '选择备份文件'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.gz,application/gzip,application/json"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0]
              e.target.value = ''
              if (picked) onPick(picked)
            }}
          />
          {file && <span className="text-xs text-muted-foreground">{file.name}</span>}
        </div>

        {preview && (
          <div className="grid gap-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>分组 <b>{preview.counts.groups}</b></span>
              <span>友链 <b>{preview.counts.friends}</b></span>
              <span>申请 <b>{preview.counts.applications}</b></span>
              <span>设置 <b>{preview.counts.settings}</b></span>
              {preview.includeArticles && <span>文章 <b>{preview.counts.articles}</b></span>}
            </div>
            <p className="text-xs text-muted-foreground">
              导出于 {fmtTime(preview.exportedAt, dtOpts)}
              {preview.appVersion ? ` · 来源版本 ${preview.appVersion}` : ''}
            </p>
            {!davConfigured && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>未配置 WebDAV，恢复前请先下载当前数据。下方勾选后才能继续。</span>
              </div>
            )}
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={ack}
                onChange={(e) => onAckChange(e.target.checked)}
              />
              {davConfigured
                ? '确认覆盖现有内容（当前数据会先自动存档到 WebDAV）'
                : '我已保存当前数据，确认用这个文件覆盖现有内容'}
            </label>
            <div className="flex justify-end">
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={!canRestore}>
                    <ArchiveRestore /> 开始恢复
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>覆盖现有数据？</AlertDialogTitle>
                    <AlertDialogDescription>
                      将清空当前的分组、友链、申请，并写入备份中的设置。此操作不可撤销。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-white hover:bg-destructive/90"
                      onClick={onRestore}
                      disabled={busy !== null}
                    >
                      {busy === 'restore' ? '恢复中…' : '确认恢复'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
