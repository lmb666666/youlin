import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink, Inbox, ShieldQuestion, ShieldCheck, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, type Application, type Group } from '@/lib/api'

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

const TABS = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' },
] as const

function BacklinkBadge({ app }: { app: Application }) {
  const b = app.backlink
  if (b.ok === true) {
    return (
      <span title={b.detail ?? ''}>
        <Badge variant="secondary">
          <ShieldCheck /> 有反链
        </Badge>
      </span>
    )
  }
  if (b.ok === false) {
    return (
      <span title={b.detail ?? ''}>
        <Badge variant="destructive">
          <ShieldQuestion /> 无反链
        </Badge>
      </span>
    )
  }
  return (
    <span title={b.detail ?? '未检测'}>
      <Badge variant="outline">未检测</Badge>
    </span>
  )
}

export default function ApplicationsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('pending')
  const [apps, setApps] = useState<Application[] | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [rebuildEnabled, setRebuildEnabled] = useState(false)
  const [approveTarget, setApproveTarget] = useState<Application | null>(null)
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null)

  const reload = useCallback(async () => {
    try {
      const [a, g, s] = await Promise.all([
        api<{ applications: Application[] }>(`/api/admin/applications?status=${tab}`),
        api<{ groups: Group[] }>('/api/admin/groups'),
        api<{ values: Record<string, unknown> }>('/api/admin/settings'),
      ])
      setApps(a.applications)
      setGroups(g.groups)
      setRebuildEnabled(s.values['rebuild.enabled'] === true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [tab])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!apps) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">申请</h1>
          <p className="text-sm text-muted-foreground">
            通过后自动入库，接口立即生效。
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border p-0.5">
          {TABS.map((t) => (
            <Button
              key={t.value}
              variant={tab === t.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Inbox className="size-8" />
            <p>{tab === 'pending' ? '没有待审核的申请' : '没有相关申请'}</p>
          </CardContent>
        </Card>
      ) : (
        apps.map((a) => (
          <Card key={a.id}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="truncate">{a.siteName}</span>
                  {a.status === 'pending' && <Badge>待审核</Badge>}
                  {a.status === 'approved' && <Badge variant="secondary">已通过</Badge>}
                  {a.status === 'rejected' && <Badge variant="destructive">已拒绝</Badge>}
                  <BacklinkBadge app={a} />
                </CardTitle>
                <CardDescription className="mt-1">
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    {a.link} <ExternalLink className="size-3" />
                  </a>
                </CardDescription>
              </div>
              {a.status === 'pending' && (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => setApproveTarget(a)}>
                    <Check /> 通过
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectTarget(a)}>
                    <X /> 拒绝
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="grid gap-1 text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {a.author && <span>站长：{a.author}</span>}
                {a.contact && <span>联系：{a.contact}</span>}
                {a.feed && <span className="truncate">feed：{a.feed}</span>}
                <span>提交于 {fmt(a.createdAt)}</span>
              </div>
              {a.desc && <p>{a.desc}</p>}
              {a.note && <p>备注：{a.note}</p>}
              {a.backlink.detail && <p className="text-xs">反链证据：{a.backlink.detail}</p>}
              {a.reviewNote && <p className="text-xs">审核记录：{a.reviewNote}</p>}
            </CardContent>
          </Card>
        ))
      )}

      <ApproveDialog
        app={approveTarget}
        groups={groups}
        rebuildEnabled={rebuildEnabled}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        onDone={() => void reload()}
      />
      <RejectDialog app={rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)} onDone={() => void reload()} />
    </div>
  )
}

function ApproveDialog(props: {
  app: Application | null
  groups: Group[]
  rebuildEnabled: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { app, groups, rebuildEnabled, onOpenChange, onDone } = props
  const [groupId, setGroupId] = useState<number | null>(null)
  const [author, setAuthor] = useState('')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [feed, setFeed] = useState('')
  const [rebuild, setRebuild] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!app) return
    setGroupId(groups[0]?.id ?? null)
    setAuthor(app.author ?? '')
    setTitle(app.siteName)
    setDesc(app.desc ?? '')
    setFeed(app.feed ?? '')
    setRebuild(false)
  }, [app, groups])

  async function submit() {
    if (!app || busy || groupId === null) return
    setBusy(true)
    try {
      const res = await api<{ friendId: number; rebuild: { triggered: boolean } | null }>(
        `/api/admin/applications/${app.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({ groupId, author, title, desc, feed, rebuild }),
        },
      )
      toast.success(`已通过并入库存为友链 #${res.friendId}${res.rebuild?.triggered ? '，已触发重建' : ''}`)
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '通过失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>通过申请：{app?.siteName}</DialogTitle>
          <DialogDescription>字段已预填，可直接修改。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">分组 *</Label>
            <Select value={groupId === null ? '' : String(groupId)} onValueChange={(v) => setGroupId(Number(v))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="选择分组" /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">作者</Label>
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">站点标题</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">feed（留空则不参与朋友圈）</Label>
            <Input value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="https://…/atom.xml" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">简介</Label>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
          </div>
          {rebuildEnabled && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={rebuild} onCheckedChange={setRebuild} />
              通过后触发接入方重建
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy || groupId === null}>
            <Check /> {busy ? '处理中…' : '通过并入库'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog(props: {
  app: Application | null
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { app, onOpenChange, onDone } = props
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (app) setReason('')
  }, [app])

  async function submit() {
    if (!app || busy) return
    setBusy(true)
    try {
      await api(`/api/admin/applications/${app.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) })
      toast.success('已拒绝该申请')
      onOpenChange(false)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>拒绝申请：{app?.siteName}</DialogTitle>
          <DialogDescription>原因仅自己可见。</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="如：缺少反链 / 内容不符合" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={busy}>确认拒绝</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
