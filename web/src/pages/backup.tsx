import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArchiveRestore, CloudDownload, CloudUpload, Download, HardDriveDownload, History, PlugZap, RefreshCw, ShieldAlert, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useSettingsRefresh } from '@/lib/settings'

interface BackupStatus {
  at: string
  ok: boolean
  target: 'download' | 'webdav' | 'pre-restore'
  bytes?: number
  file?: string
  error?: string
}

interface StatusPayload {
  last: BackupStatus | null
  backup: { enabled: boolean; schedule: string; includeArticles: boolean; retain: number }
  webdav: { configured: boolean; url: string; path: string }
}

interface PreviewSummary {
  version: number
  exportedAt: string
  appVersion: string | null
  counts: { groups: number; friends: number; applications: number; articles: number; settings: number }
  includeArticles: boolean
}

interface DavFile {
  name: string
  size: number
  lastModified?: string
}

async function readError(res: Response): Promise<string> {
  let message = `请求失败（${res.status}）`
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body.error?.message) message = body.error.message
  } catch { /* 保持默认文案 */ }
  return message
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (res.status === 401) {
    window.location.assign('/admin/login')
    throw new Error('未登录')
  }
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as T
}

function fmtBytes(n: number | undefined): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** 文件名里的时间是 UTC；展示时转成本地时间，和「最近一次」保持一致 */
function fmtBackupName(name: string): string {
  const m = /^(youlin-backup|pre-restore)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json\.gz$/.exec(name)
  if (!m) return name
  const kind = m[1] === 'pre-restore' ? '恢复前存档' : '备份'
  const at = new Date(`${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`)
  return Number.isNaN(at.getTime())
    ? `${kind} · ${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}:${m[7]} UTC`
    : `${kind} · ${at.toLocaleString()}`
}

const TARGET_LABEL = { download: '下载', webdav: 'WebDAV', 'pre-restore': '恢复前存档' } as const

export default function BackupPage() {
  const refreshSettings = useSettingsRefresh()
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [includeArticles, setIncludeArticles] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewSummary | null>(null)
  const [ack, setAck] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [davFiles, setDavFiles] = useState<DavFile[] | null>(null)
  const [davError, setDavError] = useState<string | null>(null)
  const [cloudTarget, setCloudTarget] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const hydrated = useRef(false)

  const loadStatus = useCallback(async () => {
    try {
      const s = await requestJson<StatusPayload>('/api/admin/backup/status')
      setStatus(s)
      if (!hydrated.current) {
        setIncludeArticles(s.backup.includeArticles)
        hydrated.current = true
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载备份状态失败')
    }
  }, [])

  const loadDav = useCallback(async () => {
    setDavError(null)
    try {
      const res = await requestJson<{ files: DavFile[] }>('/api/admin/backup/webdav/list')
      setDavFiles(res.files)
    } catch (err) {
      setDavFiles(null)
      setDavError(err instanceof Error ? err.message : '读取 WebDAV 失败')
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (status?.webdav.configured) void loadDav()
  }, [status?.webdav.configured, loadDav])

  async function download() {
    if (busy) return
    setBusy('download')
    try {
      const res = await fetch(`/api/admin/backup/export?articles=${includeArticles ? 1 : 0}`)
      if (!res.ok) throw new Error(await readError(res))
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') ?? ''
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'youlin-backup.json.gz'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`备份已下载（${fmtBytes(blob.size)}）`)
      void loadStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '备份失败')
    } finally {
      setBusy(null)
    }
  }

  async function testDav() {
    if (busy) return
    setBusy('dav-test')
    try {
      const res = await requestJson<{ ok: boolean; files: number }>('/api/admin/backup/webdav/test', { method: 'POST' })
      toast.success(`连接正常，目录中已有 ${res.files} 份备份`)
      void loadDav()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '连接失败')
    } finally {
      setBusy(null)
    }
  }

  async function runDav() {
    if (busy) return
    setBusy('dav-run')
    try {
      const res = await requestJson<{ ok: boolean; status: { file: string; bytes?: number }; pruned: number }>(
        '/api/admin/backup/webdav/run',
        { method: 'POST' },
      )
      toast.success(`已上传 ${res.status.file}（${fmtBytes(res.status.bytes)}${res.pruned > 0 ? `，清理 ${res.pruned} 份旧备份` : ''}）`)
      void loadStatus()
      void loadDav()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
      void loadStatus()
    } finally {
      setBusy(null)
    }
  }

  async function restoreFromCloud(name: string) {
    if (busy) return
    setBusy('dav-restore')
    setCloudTarget(null)
    try {
      const res = await requestJson<{ ok: boolean; summary: { groups: number; friends: number; applications: number; settings: number }; preRestoreFile: string | null }>(
        '/api/admin/backup/webdav/restore?confirm=1',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
      )
      const s = res.summary
      const archived = res.preRestoreFile ? `；恢复前已存档 ${fmtBackupName(res.preRestoreFile)}` : ''
      toast.success(`恢复完成：${s.groups} 个分组、${s.friends} 条友链、${s.applications} 条申请、${s.settings} 项设置${archived}`)
      refreshSettings()
      window.setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setBusy(null)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    e.target.value = ''
    setFile(null)
    setPreview(null)
    setAck(false)
    if (!picked) return
    if (picked.size > 16 * 1024 * 1024) {
      toast.error('备份文件超过 16 MB')
      return
    }
    setBusy('preview')
    try {
      const res = await fetch('/api/admin/backup/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: picked,
      })
      if (res.status === 401) {
        window.location.assign('/admin/login')
        return
      }
      const body = (await res.json()) as { summary?: PreviewSummary; error?: { message?: string } }
      if (!res.ok || !body.summary) throw new Error(body.error?.message ?? '无法读取备份文件')
      setFile(picked)
      setPreview(body.summary)
      toast.success(`已读取 ${picked.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法读取备份文件')
    } finally {
      setBusy(null)
    }
  }

  async function restore() {
    if (!file || busy) return
    setBusy('restore')
    try {
      const params = new URLSearchParams({ confirm: '1' })
      if (!status?.webdav.configured) params.set('downloaded', ack ? '1' : '0')
      const res = await fetch(`/api/admin/backup/restore?${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      if (res.status === 401) {
        window.location.assign('/admin/login')
        return
      }
      const body = (await res.json()) as {
        ok?: boolean
        summary?: { groups: number; friends: number; applications: number; articles: number; settings: number }
        preRestoreFile?: string | null
        error?: { message?: string }
      }
      if (!res.ok || !body.ok || !body.summary) throw new Error(body.error?.message ?? '恢复失败')
      const s = body.summary
      const archived = body.preRestoreFile ? `；恢复前已存档 ${fmtBackupName(body.preRestoreFile)}` : ''
      toast.success(`恢复完成：${s.groups} 个分组、${s.friends} 条友链、${s.applications} 条申请、${s.settings} 项设置${archived}`)
      refreshSettings()
      setConfirmOpen(false)
      setFile(null)
      setPreview(null)
      setAck(false)
      void loadStatus()
      window.setTimeout(() => window.location.reload(), 900)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复失败')
    } finally {
      setBusy(null)
    }
  }

  const canRestore = Boolean(file && preview && ack && !busy)
  const davConfigured = status?.webdav.configured ?? false

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 [&>*]:min-w-0">
      <div>
        <h1 className="text-lg font-semibold">备份与恢复</h1>
        <p className="text-sm text-muted-foreground">
          备份包含分组、友链、申请与全部设置。文章和体检状态是派生数据，默认不备份。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDriveDownload className="size-4" /> 立即备份
          </CardTitle>
          <CardDescription>生成 .json.gz 文件并下载到本机；也可在设置里开启自动上传 WebDAV。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={includeArticles} onCheckedChange={setIncludeArticles} />
            本次备份包含文章与体检状态
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void download()} disabled={busy !== null}>
              <Download /> {busy === 'download' ? '打包中…' : '下载备份文件'}
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
              <span>最近一次：{fmtTime(status.last.at)}</span>
              <Badge variant="outline">{TARGET_LABEL[status.last.target]}</Badge>
              <span>{status.last.ok ? `成功（${fmtBytes(status.last.bytes)}）` : `失败：${status.last.error ?? '未知错误'}`}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CloudUpload className="size-4" /> WebDAV
          </CardTitle>
          <CardDescription>地址、用户名与周期在设置页配置；密码写在 Secret（WEBDAV_PASSWORD）。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {!status ? (
            <p className="text-muted-foreground">读取中…</p>
          ) : davConfigured ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">已配置</Badge>
                <span className="break-all text-xs text-muted-foreground">{status.webdav.url}{status.webdav.path ? ` · ${status.webdav.path}` : ''}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void testDav()} disabled={busy !== null}>
                  <PlugZap /> {busy === 'dav-test' ? '检测中…' : '测试连接'}
                </Button>
                <Button onClick={() => void runDav()} disabled={busy !== null}>
                  <CloudUpload /> {busy === 'dav-run' ? '上传中…' : '立即备份到 WebDAV'}
                </Button>
                <Button variant="ghost" onClick={() => void loadDav()} disabled={busy !== null}>
                  <RefreshCw /> 刷新列表
                </Button>
              </div>
              {davError && <p className="text-xs text-destructive">{davError}</p>}
              {davFiles && davFiles.length > 0 && (
                <div className="grid gap-1 rounded-md border p-2">
                  {davFiles.map((f) => (
                    <div key={f.name} className="flex flex-wrap items-center justify-between gap-2 rounded px-1 py-1 text-xs">
                      <span className="min-w-0 truncate">{fmtBackupName(f.name)}</span>
                      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                        {fmtBytes(f.size)}
                        <AlertDialog open={cloudTarget === f.name} onOpenChange={(o) => setCloudTarget(o ? f.name : null)}>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" disabled={busy !== null}>
                              <CloudDownload /> 恢复
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>从这个云端备份恢复？</AlertDialogTitle>
                              <AlertDialogDescription>
                                会先把当前数据自动存档一份到 WebDAV，再清空并写入 {fmtBackupName(f.name)}。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-white hover:bg-destructive/90"
                                onClick={() => void restoreFromCloud(f.name)}
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
              {davFiles && davFiles.length === 0 && <p className="text-xs text-muted-foreground">云端还没有备份文件。</p>}
            </>
          ) : (
            <p className="text-muted-foreground">尚未配置。到设置页填写 WebDAV 地址与用户名，并设置 WEBDAV_PASSWORD。</p>
          )}
          <Separator className="my-1" />
          <p className="text-xs text-muted-foreground">
            自动备份与云端恢复在开启 WebDAV 后可用；同一目录保留最近 {status?.backup.retain ?? 7} 份，
            恢复前存档不会被自动清理。
          </p>
        </CardContent>
      </Card>

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
            <input ref={fileRef} type="file" accept=".json,.gz,application/gzip,application/json" className="hidden" onChange={onFile} />
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
                导出于 {fmtTime(preview.exportedAt)}
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
                  onChange={(e) => setAck(e.target.checked)}
                />
                {davConfigured
                  ? `确认覆盖现有内容（当前数据会先自动存档到 WebDAV）`
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
                        onClick={() => void restore()}
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
    </div>
  )
}
