import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  FolderPen,
  MoreHorizontal,
  Plus,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState } from '@/components/common/page-state'
import { PageHeader } from '@/components/common/page-header'
import { SearchField } from '@/components/common/search-field'
import { StatusBadge } from '@/components/common/status-badge'
import { api, type Friend, type FriendListResponse, type Group, type GroupListResponse } from '@/lib/api'
import { queryKeys, invalidateLinkData } from '@/lib/query'
import { useFriendsQuery, useGroupsQuery } from '@/lib/queries'
import { useSettings } from '@/lib/settings'
import { useQueryParam } from '@/lib/url-state'
import { FriendDialog } from './friend-dialog'
import { GroupDialog } from './group-dialog'
import { ImportDialog } from './import-dialog'
import { SortableFriendRow } from './sortable-friend-row'

type DeleteTarget = { kind: 'friend' | 'group'; id: number; name: string }

const COLLAPSE_KEY = 'youlin-links-collapsed'

function readCollapsed(): Set<number> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((id): id is number => typeof id === 'number') : [])
  } catch {
    return new Set()
  }
}

export default function LinksPage() {
  const client = useQueryClient()
  const settings = useSettings()
  const groupsQuery = useGroupsQuery()
  const friendsQuery = useFriendsQuery()

  const [q, setQ] = useQueryParam('q')
  const [groupParam, setGroupParam] = useQueryParam('group', 'all')
  const [importParam, setImportParam] = useQueryParam('import')
  const [newParam, setNewParam] = useQueryParam('new')

  const [dialog, setDialog] = useState<{ open: boolean; editing: Friend | null; presetGroupId: number | null }>({
    open: false,
    editing: null,
    presetGroupId: null,
  })
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; editing: Group | null }>({ open: false, editing: null })
  const [importOpen, setImportOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(readCollapsed)
  const [visible, setVisible] = useState<Record<number, number>>({})

  const pageSize = Math.max(1, typeof settings['ui.pageSize'] === 'number' ? (settings['ui.pageSize'] as number) : 20)
  const deferredQ = useDeferredValue(q.trim().toLowerCase())
  const searching = deferredQ !== ''

  const groups = useMemo(() => (groupsQuery.data?.groups ?? []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id), [groupsQuery.data])
  const friends = useMemo(() => friendsQuery.data?.friends ?? [], [friendsQuery.data])

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]))
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, [collapsed])

  useEffect(() => {
    if (importParam === '1') {
      setImportOpen(true)
      setImportParam(null)
    }
  }, [importParam, setImportParam])

  useEffect(() => {
    if (newParam === '1') {
      setDialog({ open: true, editing: null, presetGroupId: groups[0]?.id ?? null })
      setNewParam(null)
    }
  }, [newParam, groups, setNewParam])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reorderFriends = useMutation({
    mutationFn: (items: { id: number; sort: number }[]) =>
      api('/api/admin/friends/reorder', { method: 'POST', body: JSON.stringify({ items }) }),
    onMutate: async (items) => {
      await client.cancelQueries({ queryKey: queryKeys.friends })
      const previous = client.getQueryData<FriendListResponse>(queryKeys.friends)
      client.setQueryData<FriendListResponse>(queryKeys.friends, (old) =>
        old
          ? {
              friends: old.friends.map((friend) => {
                const item = items.find((entry) => entry.id === friend.id)
                return item ? { ...friend, sort: item.sort } : friend
              }),
            }
          : old,
      )
      return { previous }
    },
    onError: (error, _items, context) => {
      if (context?.previous) client.setQueryData(queryKeys.friends, context.previous)
      toast.error(error instanceof Error ? error.message : '排序保存失败')
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.friends })
    },
  })

  const reorderGroups = useMutation({
    mutationFn: (items: { id: number; sort: number }[]) =>
      api('/api/admin/groups/reorder', { method: 'POST', body: JSON.stringify({ items }) }),
    onMutate: async (items) => {
      await client.cancelQueries({ queryKey: queryKeys.groups })
      const previous = client.getQueryData<GroupListResponse>(queryKeys.groups)
      client.setQueryData<GroupListResponse>(queryKeys.groups, (old) =>
        old
          ? {
              groups: old.groups.map((group) => {
                const item = items.find((entry) => entry.id === group.id)
                return item ? { ...group, sort: item.sort } : group
              }),
            }
          : old,
      )
      return { previous }
    },
    onError: (error, _items, context) => {
      if (context?.previous) client.setQueryData(queryKeys.groups, context.previous)
      toast.error(error instanceof Error ? error.message : '分组排序保存失败')
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.groups })
    },
  })

  const toggleHidden = useMutation({
    mutationFn: (friend: Friend) =>
      api(`/api/admin/friends/${friend.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: friend.status === 'hidden' ? 'active' : 'hidden' }),
      }),
    onMutate: async (friend) => {
      await client.cancelQueries({ queryKey: queryKeys.friends })
      const previous = client.getQueryData<FriendListResponse>(queryKeys.friends)
      client.setQueryData<FriendListResponse>(queryKeys.friends, (old) =>
        old
          ? {
              friends: old.friends.map((item) =>
                item.id === friend.id ? { ...item, status: item.status === 'hidden' ? 'active' : 'hidden' } : item,
              ),
            }
          : old,
      )
      return { previous }
    },
    onError: (error, _friend, context) => {
      if (context?.previous) client.setQueryData(queryKeys.friends, context.previous)
      toast.error(error instanceof Error ? error.message : '操作失败')
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.friends })
      void client.invalidateQueries({ queryKey: queryKeys.stats })
    },
  })

  const remove = useMutation({
    mutationFn: (target: DeleteTarget) =>
      api(target.kind === 'friend' ? `/api/admin/friends/${target.id}` : `/api/admin/groups/${target.id}`, {
        method: 'DELETE',
      }),
    onSuccess: (_data, target) => {
      setDeleteTarget(null)
      invalidateLinkData(client)
      toast.success(target.kind === 'friend' ? '友链已删除' : '分组及其友链已删除')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '删除失败'),
  })

  const groupCount = (groupId: number) => friends.filter((friend) => friend.groupId === groupId).length

  const friendsOf = useMemo(() => {
    const matcher = (friend: Friend) =>
      !searching ||
      [friend.author, friend.nickname, friend.title, friend.link, friend.desc].some((value) =>
        value?.toLowerCase().includes(deferredQ),
      )
    const map = new Map<number, Friend[]>()
    for (const friend of friends) {
      if (!matcher(friend)) continue
      const list = map.get(friend.groupId) ?? []
      list.push(friend)
      map.set(friend.groupId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.sort - b.sort || a.id - b.id)
    return map
  }, [friends, deferredQ, searching])

  const visibleGroups = groupParam === 'all' ? groups : groups.filter((group) => String(group.id) === groupParam)

  function handleDragEnd(groupId: number, event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const list = friends.filter((friend) => friend.groupId === groupId).sort((a, b) => a.sort - b.sort || a.id - b.id)
    const from = list.findIndex((friend) => friend.id === active.id)
    const to = list.findIndex((friend) => friend.id === over.id)
    if (from < 0 || to < 0) return
    reorderFriends.mutate(arrayMove(list, from, to).map((friend, index) => ({ id: friend.id, sort: index })))
  }

  function moveFriend(friend: Friend, direction: -1 | 1) {
    const list = friends.filter((item) => item.groupId === friend.groupId).sort((a, b) => a.sort - b.sort || a.id - b.id)
    const index = list.findIndex((item) => item.id === friend.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= list.length) return
    reorderFriends.mutate(arrayMove(list, index, target).map((item, order) => ({ id: item.id, sort: order })))
  }

  function moveGroup(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    reorderGroups.mutate(arrayMove(groups, index, target).map((group, order) => ({ id: group.id, sort: order })))
  }

  function toggleCollapsed(groupId: number) {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  if (groupsQuery.isError || friendsQuery.isError) {
    return (
      <div className="grid min-w-0 gap-5">
        <PageHeader title="友链" description="拖拽排序，保存后立即生效。" />
        <ErrorState
          title="友链数据加载失败"
          error={groupsQuery.error ?? friendsQuery.error}
          onRetry={() => {
            void groupsQuery.refetch()
            void friendsQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (groupsQuery.isPending || friendsQuery.isPending) {
    return (
      <div className="grid gap-5">
        <PageHeader title="友链" description="拖拽排序，保存后立即生效。" />
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-48 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
      </div>
    )
  }

  const total = friends.length

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={`${total} 条记录 · ${groups.length} 个分组`}
        title="友链"
        description="拖拽排序，保存后立即生效；也可以从操作菜单上移/下移。"
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload /> 导入
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download /> 导出
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild><a href="/api/admin/export?format=json" download>JSON</a></DropdownMenuItem>
                <DropdownMenuItem asChild><a href="/api/admin/export?format=csv" download>CSV</a></DropdownMenuItem>
                <DropdownMenuItem asChild><a href="/api/admin/export?format=opml" download>OPML</a></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setGroupDialog({ open: true, editing: null })}>
              <Plus /> 新建分组
            </Button>
            <Button
              disabled={groups.length === 0}
              onClick={() => setDialog({ open: true, editing: null, presetGroupId: groups[0]?.id ?? null })}
            >
              <Plus /> 添加友链
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="搜索作者 / 链接 / 标题 / 简介"
          ariaLabel="搜索友链"
          className="w-full sm:max-w-xs"
        />
        <Select value={groupParam} onValueChange={setGroupParam}>
          <SelectTrigger className="h-9 w-full sm:w-44" aria-label="按分组筛选">
            <SelectValue placeholder="全部分组" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分组</SelectItem>
            {groups.map((group) => (
              <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="hidden flex-1 sm:block" />
        <p className="text-[11px] text-subtle">
          {searching ? `匹配 ${Array.from(friendsOf.values()).reduce((sum, list) => sum + list.length, 0)} 条` : `共 ${total} 条`}
        </p>
      </div>

      {groups.length === 0 && (
        <Card className="py-0">
          <EmptyState
            icon={FolderPen}
            title="还没有分组"
            description="先新建一个分组，或导入已有友链数据。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setGroupDialog({ open: true, editing: null })}><Plus /> 新建分组</Button>
                <Button variant="outline" onClick={() => setImportOpen(true)}><Upload /> 导入数据</Button>
              </div>
            }
          />
        </Card>
      )}

      {groups.length > 0 && visibleGroups.length === 0 && (
        <Card className="py-0">
          <EmptyState icon={FolderPen} title="没有匹配的分组" description="换一个分组或清空筛选试试。" />
        </Card>
      )}

      {visibleGroups.map((group) => {
        const allRows = friendsOf.get(group.id) ?? []
        const limit = searching ? allRows.length : (visible[group.id] ?? pageSize)
        const rows = allRows.slice(0, limit)
        const remaining = allRows.length - rows.length
        const isCollapsed = !searching && collapsed.has(group.id)
        const originalIndex = groups.findIndex((item) => item.id === group.id)

        return (
          <Card key={group.id} className="min-w-0 gap-0 py-0">
            <div className="flex items-center gap-1.5 border-b px-2.5 py-2.5 sm:px-4">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => toggleCollapsed(group.id)}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `展开分组 ${group.name}` : `折叠分组 ${group.name}`}
              >
                {isCollapsed ? <ChevronRight /> : <ChevronDown />}
              </Button>
              <h2 className="font-serif text-base font-semibold">{group.name}</h2>
              <StatusBadge tone="neutral">{groupCount(group.id)}</StatusBadge>
              {group.desc && <p className="hidden truncate text-[11px] text-subtle md:block">{group.desc}</p>}
              <span className="flex-1" />
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveGroup(originalIndex, -1)}
                  disabled={originalIndex <= 0 || reorderGroups.isPending}
                  aria-label="分组上移"
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveGroup(originalIndex, 1)}
                  disabled={originalIndex < 0 || originalIndex >= groups.length - 1 || reorderGroups.isPending}
                  aria-label="分组下移"
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDialog({ open: true, editing: null, presetGroupId: group.id })}
                  aria-label={`向 ${group.name} 添加友链`}
                >
                  <Plus />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`分组操作：${group.name}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setGroupDialog({ open: true, editing: group })}>
                      <FolderPen /> 编辑分组
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteTarget({ kind: 'group', id: group.id, name: group.name })}
                    >
                      删除分组（含友链）
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {isCollapsed ? null : rows.length === 0 ? (
              <EmptyState
                compact
                icon={FolderPen}
                title={searching ? '没有匹配的友链' : '分组为空'}
                description={searching ? '换一个关键词试试。' : '添加友链，或把已有友链拖到这个分组。'}
                action={<Button variant="outline" size="sm" onClick={() => setDialog({ open: true, editing: null, presetGroupId: group.id })}>添加友链</Button>}
              />
            ) : (
              <>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(group.id, event)}>
                  <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
                    <ul>
                      {rows.map((friend) => (
                        <SortableFriendRow
                          key={friend.id}
                          friend={friend}
                          onEdit={() => setDialog({ open: true, editing: friend, presetGroupId: null })}
                          onToggleHidden={() => toggleHidden.mutate(friend)}
                          onDelete={() => setDeleteTarget({ kind: 'friend', id: friend.id, name: friend.author })}
                          onMoveUp={() => moveFriend(friend, -1)}
                          onMoveDown={() => moveFriend(friend, 1)}
                          pending={toggleHidden.isPending && toggleHidden.variables?.id === friend.id}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                {remaining > 0 && (
                  <div className="border-t p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => setVisible((previous) => ({ ...previous, [group.id]: limit + pageSize }))}
                    >
                      再显示 {Math.min(pageSize, remaining)} 条（剩余 {remaining} 条）
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        )
      })}

      <FriendDialog
        groups={groups}
        editing={dialog.editing}
        presetGroupId={dialog.presetGroupId}
        open={dialog.open}
        onOpenChange={(open) => setDialog((previous) => ({ ...previous, open }))}
      />
      <GroupDialog
        editing={groupDialog.editing}
        open={groupDialog.open}
        onOpenChange={(open) => setGroupDialog((previous) => ({ ...previous, open }))}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={deleteTarget?.kind === 'group' ? '删除分组？' : '删除友链？'}
        description={
          deleteTarget
            ? deleteTarget.kind === 'group'
              ? `将删除「${deleteTarget.name}」及其全部友链，不可恢复。`
              : `将删除「${deleteTarget.name}」及其文章，不可恢复。`
            : null
        }
        confirmLabel="删除"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  )
}
