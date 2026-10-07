import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useState, useId } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates, SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, GripVertical, Pencil, Plus, EyeOff, Eye, Trash2, TriangleAlert, FolderPen, ArrowUp, ArrowDown, Sparkles, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, type Friend, type Group } from '@/lib/api'
import { useSettings } from '@/lib/settings'

// ── 编辑弹窗 ──────────────────────────────────────────────────────────────

export interface FriendFormValues {
  groupId: number
  author: string
  nickname?: string
  title?: string
  desc?: string
  link: string
  feed?: string
  icon?: string
  avatar?: string
  archsText: string
  since: string
  comment?: string
  inCircle: boolean
  status: 'active' | 'hidden'
}

function FriendDialog(props: {
  groups: Group[]
  editing: Friend | null
  presetGroupId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { groups, editing, presetGroupId, open, onOpenChange, onSaved } = props
  const groupFieldId = useId()
  const statusFieldId = useId()
  const [values, setValues] = useState<FriendFormValues | null>(null)
  const [busy, setBusy] = useState(false)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    if (!open) return
    setValues(
      editing
        ? {
            groupId: editing.groupId,
            author: editing.author,
            nickname: editing.nickname ?? '',
            title: editing.title ?? '',
            desc: editing.desc ?? '',
            link: editing.link,
            feed: editing.feed ?? '',
            icon: editing.icon ?? '',
            avatar: editing.avatar ?? '',
            archsText: (editing.archs ?? []).join(', '),
            since: editing.since,
            comment: editing.comment ?? '',
            inCircle: editing.inCircle,
            status: editing.status,
          }
        : {
            groupId: presetGroupId ?? groups[0]?.id ?? 0,
            author: '', nickname: '', title: '', desc: '', link: '', feed: '', icon: '',
            avatar: '', archsText: '', since: new Date().toISOString().slice(0, 10),
            comment: '', inCircle: true, status: 'active',
          },
    )
  }, [open, editing, presetGroupId, groups])

  function set<K extends keyof FriendFormValues>(key: K, value: FriendFormValues[K]) {
    setValues((v) => (v ? { ...v, [key]: value } : v))
  }

  // 自动探测：发现 RSS、抓 favicon、站点标题、og:image 头像建议（空字段才回填，不覆盖已填内容）
  async function probe() {
    if (!values || probing || !/^https?:\/\//.test(values.link)) {
      if (values && !/^https?:\/\//.test(values.link)) toast.info('请先填写站点链接')
      return
    }
    setProbing(true)
    try {
      const res = await api<{ probe: { feed?: string; title?: string; icon?: string; avatar?: string } }>(
        '/api/admin/friends/probe',
        { method: 'POST', body: JSON.stringify({ link: values.link, feed: values.feed || null }) },
      )
      const p = res.probe
      let filled = 0
      if (p.feed && !values.feed) { set('feed', p.feed); filled++ }
      if (p.title && !values.title) { set('title', p.title); filled++ }
      if (p.icon && !values.icon) { set('icon', p.icon); filled++ }
      if (p.avatar && !values.avatar) { set('avatar', p.avatar); filled++ }
      if (filled > 0) toast.success(`探测完成，已回填 ${filled} 项`)
      else if (p.feed || p.title || p.icon || p.avatar) toast.info('没有需要回填的内容')
      else toast.info('未探测到可回填的信息')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '探测失败')
    } finally {
      setProbing(false)
    }
  }

  async function submit() {
    if (!values || busy) return
    setBusy(true)
    const archs = values.archsText.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
    const body = {
      groupId: values.groupId,
      author: values.author,
      nickname: values.nickname || null,
      title: values.title || null,
      desc: values.desc || null,
      link: values.link,
      feed: values.feed || null,
      icon: values.icon || null,
      avatar: values.avatar || null,
      archs,
      since: values.since,
      comment: values.comment || null,
      inCircle: values.inCircle,
      status: values.status,
    }
    try {
      if (editing) {
        await api(`/api/admin/friends/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast.success('友链已更新')
      } else {
        await api('/api/admin/friends', { method: 'POST', body: JSON.stringify(body) })
        toast.success('友链已添加')
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑友链' : '添加友链'}</DialogTitle>
          <DialogDescription>feed 留空则不参与朋友圈。</DialogDescription>
        </DialogHeader>
        {values && (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="分组" htmlFor={groupFieldId}>
                <Select value={String(values.groupId)} onValueChange={(v) => set('groupId', Number(v))}>
                  <SelectTrigger id={groupFieldId} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="状态" htmlFor={statusFieldId}>
                <Select value={values.status} onValueChange={(v) => set('status', v as FriendFormValues['status'])}>
                  <SelectTrigger id={statusFieldId} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">显示</SelectItem>
                    <SelectItem value="hidden">隐藏</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="站点名 *">
                <Input value={values.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="站点名" />
              </Field>
              <Field label="订阅日期 *">
                <Input type="date" value={values.since} onChange={(e) => set('since', e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="作者">
                <Input value={values.author} onChange={(e) => set('author', e.target.value)} placeholder="留空则显示站点名" />
              </Field>
              <Field label="趣称">
                <Input value={values.nickname ?? ''} onChange={(e) => set('nickname', e.target.value)} placeholder="网站趣称" />
              </Field>
            </div>
            <Field label="站点链接 *">
              <Input value={values.link} onChange={(e) => set('link', e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="订阅源 feed">
              <Input value={values.feed ?? ''} onChange={(e) => set('feed', e.target.value)} placeholder="https://…/atom.xml" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="图标 icon">
                <Input value={values.icon ?? ''} onChange={(e) => set('icon', e.target.value)} placeholder="favicon 地址" />
              </Field>
              <Field label="头像 avatar">
                <Input value={values.avatar ?? ''} onChange={(e) => set('avatar', e.target.value)} placeholder="头像地址" />
              </Field>
            </div>
            {values.avatar && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <img src={values.avatar} alt="" className="size-8 rounded-full border object-cover" />
                头像预览
              </div>
            )}
            <Field label="架构（逗号分隔）">
              <Input value={values.archsText} onChange={(e) => set('archsText', e.target.value)} placeholder="Nuxt, VitePress" />
            </Field>
            <Field label="备注">
              <Textarea value={values.comment ?? ''} onChange={(e) => set('comment', e.target.value)} rows={2} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={values.inCircle} onCheckedChange={(v) => set('inCircle', v)} />
              纳入朋友圈抓取
            </label>
          </div>
        )}
        <DialogFooter className="items-center sm:justify-between">
          <Button variant="outline" onClick={() => void probe()} disabled={probing || !values?.link} className="mr-auto">
            <Sparkles /> {probing ? '探测中…' : '自动探测'}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button onClick={() => void submit()} disabled={busy || !values?.title || !values?.link || !values?.since}>
              {busy ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  const autoId = useId()
  const id = htmlFor ?? autoId
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {htmlFor || !isValidElement(children) ? children : cloneElement(children as React.ReactElement<{ id?: string }>, { id })}
    </div>
  )
}

// ── 分组弹窗 ──────────────────────────────────────────────────────────────

function GroupDialog(props: {
  editing: Group | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { editing, open, onOpenChange, onSaved } = props
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? '')
      setDesc(editing?.desc ?? '')
    }
  }, [open, editing])

  async function submit() {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      if (editing) {
        await api(`/api/admin/groups/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ name, desc: desc || null }) })
        toast.success('分组已更新')
      } else {
        await api('/api/admin/groups', { method: 'POST', body: JSON.stringify({ name, desc: desc || null }) })
        toast.success('分组已创建')
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑分组' : '新建分组'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="名称 *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：朋友们" />
          </Field>
          <Field label="说明">
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="展示在分组标题下（可选）" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── 可排序友链行 ──────────────────────────────────────────────────────────

function SortableFriendRow(props: {
  friend: Friend
  onEdit: () => void
  onToggleHidden: () => void
  onDelete: () => void
}) {
  const { friend, onEdit, onToggleHidden, onDelete } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: friend.id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 ${isDragging ? 'z-10 opacity-80 shadow-lg' : ''}`}
    >
      <button
        {...attributes} {...listeners}
        className="cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        aria-label="拖拽排序"
      >
        <GripVertical className="size-4" />
      </button>
      <Avatar friend={friend} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{friend.author}</span>
          {friend.nickname && friend.nickname !== friend.author && (
            <span className="truncate text-xs font-normal text-muted-foreground">「{friend.nickname}」</span>
          )}
        </div>
        <a href={friend.link} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-muted-foreground hover:underline">
          {friend.link}
        </a>
      </div>
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        {friend.status === 'hidden' && <Badge variant="secondary">已隐藏</Badge>}
        {!friend.inCircle && <Badge variant="outline">不入圈</Badge>}
        {friend.state?.reachable === false && <Badge variant="destructive">失联</Badge>}
        {(friend.archs ?? []).slice(0, 2).map((a) => (
          <Badge key={a} variant="outline" className="text-muted-foreground">{a}</Badge>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={onEdit} aria-label="编辑">
          <Pencil className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" onClick={onToggleHidden} aria-label={friend.status === 'hidden' ? '显示' : '隐藏'}>
          {friend.status === 'hidden' ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={onDelete} aria-label="删除">
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function Avatar({ friend }: { friend: Friend }) {
  const [failed, setFailed] = useState(false)
  const src = friend.avatar || friend.icon
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="size-9 shrink-0 rounded-full border object-cover"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted text-sm text-muted-foreground">
      {friend.author.slice(0, 1).toUpperCase()}
    </div>
  )
}

// ── 页面 ──────────────────────────────────────────────────────────────────

export default function LinksPage() {
  const settings = useSettings()
  const pageSize = typeof settings['ui.pageSize'] === 'number' ? (settings['ui.pageSize'] as number) : 20
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [friends, setFriends] = useState<Friend[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [friendDialog, setFriendDialog] = useState<{ open: boolean; editing: Friend | null; presetGroupId: number | null }>({
    open: false, editing: null, presetGroupId: null,
  })
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; editing: Group | null }>({ open: false, editing: null })
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'friend' | 'group'; id: number; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reload = useCallback(async () => {
    try {
      const [g, f] = await Promise.all([
        api<{ groups: Group[] }>('/api/admin/groups'),
        api<{ friends: Friend[] }>('/api/admin/friends'),
      ])
      setGroups(g.groups)
      setFriends(f.friends)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const q = query.trim().toLowerCase()
  const searching = q !== ''
  const matches = useCallback(
    (f: Friend) =>
      !searching ||
      [f.author, f.nickname, f.title, f.link, f.desc].some((v) => v?.toLowerCase().includes(q)),
    [q, searching],
  )

  const friendsOf = useMemo(() => {
    const map = new Map<number, Friend[]>()
    for (const f of friends) {
      if (!matches(f)) continue
      const list = map.get(f.groupId) ?? []
      list.push(f)
      map.set(f.groupId, list)
    }
    return map
  }, [friends, matches])

  function toggleCollapsed(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleDragEnd(groupId: number, event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const list = friendsOf.get(groupId) ?? []
    const from = list.findIndex((f) => f.id === active.id)
    const to = list.findIndex((f) => f.id === over.id)
    if (from < 0 || to < 0) return
    const next = arrayMove(list, from, to)
    setFriends((prev) => prev.map((f) => {
      const idx = next.findIndex((n) => n.id === f.id)
      return idx >= 0 ? { ...f, sort: idx } : f
    }))
    try {
      await api('/api/admin/friends/reorder', {
        method: 'POST',
        body: JSON.stringify({ items: next.map((f, i) => ({ id: f.id, sort: i })) }),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '排序保存失败')
      void reload()
    }
  }

  async function moveGroup(index: number, delta: -1 | 1) {
    if (!groups) return
    const to = index + delta
    if (to < 0 || to >= groups.length) return
    const next = arrayMove(groups, index, to)
    setGroups(next.map((g, i) => ({ ...g, sort: i })))
    try {
      await api('/api/admin/groups/reorder', {
        method: 'POST',
        body: JSON.stringify({ items: next.map((g, i) => ({ id: g.id, sort: i })) }),
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '排序保存失败')
      void reload()
    }
  }

  async function toggleHidden(f: Friend) {
    try {
      await api(`/api/admin/friends/${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: f.status === 'hidden' ? 'active' : 'hidden' }),
      })
      toast.success(f.status === 'hidden' ? '已恢复显示' : '已隐藏')
      void reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || busy) return
    setBusy(true)
    try {
      const path = deleteTarget.kind === 'friend' ? `/api/admin/friends/${deleteTarget.id}` : `/api/admin/groups/${deleteTarget.id}`
      await api(path, { method: 'DELETE' })
      toast.success(deleteTarget.kind === 'friend' ? '友链已删除' : '分组及其友链已删除')
      setDeleteTarget(null)
      void reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  if (!groups) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">友链</h1>
          <p className="text-sm text-muted-foreground">拖拽排序，保存后立即生效。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索作者 / 链接 / 标题"
              className="h-9 w-52 pl-8"
            />
          </div>
          <Button variant="outline" onClick={() => setGroupDialog({ open: true, editing: null })}>
            <Plus /> 新建分组
          </Button>
          <Button
            disabled={groups.length === 0}
            onClick={() => setFriendDialog({ open: true, editing: null, presetGroupId: groups[0]?.id ?? null })}
          >
            <Plus /> 添加友链
          </Button>
        </div>
      </div>

      {groups.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <TriangleAlert className="size-8" />
            <p>先新建分组，或到「导入」页批量迁入。</p>
          </CardContent>
        </Card>
      )}

      {groups.map((g, gi) => {
        const allRows = friendsOf.get(g.id) ?? []
        const rows = !expanded.has(g.id) && allRows.length > pageSize ? allRows.slice(0, pageSize) : allRows
        const clipped = allRows.length > pageSize && !expanded.has(g.id)
        const isCollapsed = !searching && collapsed.has(g.id)
        return (
          <Card key={g.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleCollapsed(g.id)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={isCollapsed ? '展开分组' : '折叠分组'}
                >
                  {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                </button>
                <CardTitle className="text-base">{g.name}</CardTitle>
                <Badge variant="secondary">{allRows.length}</Badge>
                {g.desc && <span className="hidden text-sm text-muted-foreground md:inline">{g.desc}</span>}
              </div>
              <div className="flex items-center gap-0.5">
                <Badge variant="secondary" className="hidden md:inline-flex">{rows.length}</Badge>
                <Button variant="ghost" size="icon" className="size-8" disabled={gi === 0} onClick={() => void moveGroup(gi, -1)} aria-label="上移分组">
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" disabled={gi === groups.length - 1} onClick={() => void moveGroup(gi, 1)} aria-label="下移分组">
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setFriendDialog({ open: true, editing: null, presetGroupId: g.id })} aria-label="向此分组添加友链">
                  <Plus className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="分组操作">
                      <FolderPen className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setGroupDialog({ open: true, editing: g })}>编辑分组</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: 'group', id: g.id, name: g.name })}>
                      删除分组（含友链）
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent>
              {isCollapsed ? null : rows.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {searching ? '没有匹配的友链' : '分组为空'}
                </p>
              ) : (
                <>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void handleDragEnd(g.id, e)}>
                  <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                    <div className="grid gap-1.5">
                      {rows.map((f) => (
                        <SortableFriendRow
                          key={f.id}
                          friend={f}
                          onEdit={() => setFriendDialog({ open: true, editing: f, presetGroupId: null })}
                          onToggleHidden={() => void toggleHidden(f)}
                          onDelete={() => setDeleteTarget({ kind: 'friend', id: f.id, name: f.author })}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                {clipped && (
                  <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setExpanded((prev) => new Set(prev).add(g.id))}>
                    显示全部 {allRows.length} 条
                  </Button>
                )}
                </>
              )}
            </CardContent>
          </Card>
        )
      })}

      <FriendDialog
        groups={groups}
        editing={friendDialog.editing}
        presetGroupId={friendDialog.presetGroupId}
        open={friendDialog.open}
        onOpenChange={(open) => setFriendDialog((s) => ({ ...s, open }))}
        onSaved={() => void reload()}
      />
      <GroupDialog editing={groupDialog.editing} open={groupDialog.open} onOpenChange={(open) => setGroupDialog((s) => ({ ...s, open }))} onSaved={() => void reload()} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === 'group'
                ? `将删除「${deleteTarget.name}」及其全部友链，不可恢复。`
                : `将删除「${deleteTarget?.name}」及其文章，不可恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
