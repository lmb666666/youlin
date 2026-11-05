import { useCallback, useMemo, useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates, SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Plus, ArrowUp, ArrowDown, FolderPen, Search, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/query-error'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { api, type Friend, type FriendListResponse, type Group, type GroupListResponse } from '@/lib/api'
import { useFriendsQuery, useGroupsQuery } from '@/lib/queries'
import { invalidateLinkData, queryKeys } from '@/lib/query'
import { useQueryErrorToast } from '@/lib/query-error'
import { useSettings } from '@/lib/settings'
import { FriendDialog } from './friend-dialog'
import { GroupDialog } from './group-dialog'
import { SortableFriendRow } from './sortable-friend-row'

export default function LinksPage() {
  const settings = useSettings()
  const client = useQueryClient()
  const groupsQuery = useGroupsQuery()
  const friendsQuery = useFriendsQuery()
  useQueryErrorToast(groupsQuery.error ?? friendsQuery.error)

  const pageSize = Math.max(1, typeof settings['ui.pageSize'] === 'number' ? (settings['ui.pageSize'] as number) : 20)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [friendDialog, setFriendDialog] = useState<{ open: boolean; editing: Friend | null; presetGroupId: number | null }>({
    open: false, editing: null, presetGroupId: null,
  })
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; editing: Group | null }>({ open: false, editing: null })
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'friend' | 'group'; id: number; name: string } | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const groups = useMemo(() => groupsQuery.data?.groups ?? [], [groupsQuery.data])
  const friends = useMemo(() => friendsQuery.data?.friends ?? [], [friendsQuery.data])

  const reorderFriendsMutation = useMutation({
    mutationFn: (items: { id: number; sort: number }[]) =>
      api('/api/admin/friends/reorder', { method: 'POST', body: JSON.stringify({ items }) }),
    onMutate: (items) => {
      const previous = client.getQueryData<FriendListResponse>(queryKeys.friends)
      client.setQueryData<FriendListResponse>(queryKeys.friends, (old) =>
        old ? { friends: old.friends.map((f) => {
          const idx = items.findIndex((i) => i.id === f.id)
          return idx >= 0 ? { ...f, sort: items[idx]!.sort } : f
        }) } : old,
      )
      return { previous }
    },
    onError: (err, _items, ctx) => {
      if (ctx?.previous) client.setQueryData(queryKeys.friends, ctx.previous)
      toast.error(err instanceof Error ? err.message : '排序保存失败')
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.friends }),
  })

  const reorderGroupsMutation = useMutation({
    mutationFn: (items: { id: number; sort: number }[]) =>
      api('/api/admin/groups/reorder', { method: 'POST', body: JSON.stringify({ items }) }),
    onMutate: (items) => {
      const previous = client.getQueryData<GroupListResponse>(queryKeys.groups)
      client.setQueryData<GroupListResponse>(queryKeys.groups, (old) =>
        old ? { groups: items.map((item) => {
          const group = old.groups.find((g) => g.id === item.id)!
          return { ...group, sort: item.sort }
        }) } : old,
      )
      return { previous }
    },
    onError: (err, _items, ctx) => {
      if (ctx?.previous) client.setQueryData(queryKeys.groups, ctx.previous)
      toast.error(err instanceof Error ? err.message : '排序保存失败')
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.groups }),
  })

  const toggleHiddenMutation = useMutation({
    mutationFn: (f: Friend) =>
      api(`/api/admin/friends/${f.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: f.status === 'hidden' ? 'active' : 'hidden' }),
      }),
    onSuccess: (_data, f) => {
      toast.success(f.status === 'hidden' ? '已恢复显示' : '已隐藏')
      invalidateLinkData(client)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  const deleteMutation = useMutation({
    mutationFn: (target: { kind: 'friend' | 'group'; id: number }) => {
      const path = target.kind === 'friend' ? `/api/admin/friends/${target.id}` : `/api/admin/groups/${target.id}`
      return api(path, { method: 'DELETE' })
    },
    onSuccess: (_data, target) => {
      toast.success(target.kind === 'friend' ? '友链已删除' : '分组及其友链已删除')
      setDeleteTarget(null)
      invalidateLinkData(client)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

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
    // 渲染顺序以 sort 为准：拖拽只改了 sort 字段，数组顺序可能还是旧的
    for (const list of map.values()) list.sort((a, b) => a.sort - b.sort || a.id - b.id)
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

  function handleDragEnd(groupId: number, event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    // 排序以整组为准：搜索是过滤视图，只重排命中子集会让未命中的行 sort 与命中的重叠
    const list = friends.filter((f) => f.groupId === groupId).sort((a, b) => a.sort - b.sort || a.id - b.id)
    const from = list.findIndex((f) => f.id === active.id)
    const to = list.findIndex((f) => f.id === over.id)
    if (from < 0 || to < 0) return
    const next = arrayMove(list, from, to)
    reorderFriendsMutation.mutate(next.map((f, i) => ({ id: f.id, sort: i })))
  }

  function moveGroup(index: number, delta: -1 | 1) {
    const to = index + delta
    if (to < 0 || to >= groups.length) return
    const next = arrayMove(groups, index, to)
    reorderGroupsMutation.mutate(next.map((g, i) => ({ id: g.id, sort: i })))
  }

  if (groupsQuery.isError || friendsQuery.isError) {
    return (
      <QueryError
        message={groupsQuery.error instanceof Error ? groupsQuery.error.message : '数据加载失败'}
        onRetry={() => { void groupsQuery.refetch(); void friendsQuery.refetch() }}
      />
    )
  }

  if (groupsQuery.isPending || friendsQuery.isPending) {
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
                <Button variant="ghost" size="icon" className="size-8" disabled={gi === 0} onClick={() => moveGroup(gi, -1)} aria-label="上移分组">
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" disabled={gi === groups.length - 1} onClick={() => moveGroup(gi, 1)} aria-label="下移分组">
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
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(g.id, e)}>
                    <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                      <div className="grid gap-1.5">
                        {rows.map((f) => (
                          <SortableFriendRow
                            key={f.id}
                            friend={f}
                            onEdit={() => setFriendDialog({ open: true, editing: f, presetGroupId: null })}
                            onToggleHidden={() => toggleHiddenMutation.mutate(f)}
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
      />
      <GroupDialog
        editing={groupDialog.editing}
        open={groupDialog.open}
        onOpenChange={(open) => setGroupDialog((s) => ({ ...s, open }))}
      />

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
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              disabled={deleteMutation.isPending}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
