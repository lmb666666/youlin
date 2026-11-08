import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/common/avatar'
import { StatusBadge } from '@/components/common/status-badge'
import type { Friend } from '@/lib/api'
import { cn } from '@/lib/utils'

export function SortableFriendRow({
  friend,
  onEdit,
  onToggleHidden,
  onDelete,
  onMoveUp,
  onMoveDown,
  pending = false,
}: {
  friend: Friend
  onEdit: () => void
  onToggleHidden: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  pending?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: friend.id })
  const hidden = friend.status === 'hidden'
  const unreachable = friend.state?.reachable === false

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2.5 border-b px-3 py-2.5 last:border-0 sm:px-4',
        'transition-colors hover:bg-secondary/50',
        isDragging && 'relative z-10 bg-card opacity-80 shadow-lg',
        pending && 'opacity-60',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-subtle hover:bg-accent hover:text-foreground active:cursor-grabbing"
        aria-label="拖拽排序（也可在操作菜单中上移/下移）"
      >
        <GripVertical className="size-4" />
      </button>

      <Avatar name={friend.author} src={friend.avatar || friend.icon} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-sm font-medium">{friend.author}</span>
          {friend.nickname && friend.nickname !== friend.author && (
            <span className="truncate text-[11px] text-subtle">「{friend.nickname}」</span>
          )}
        </div>
        <a
          href={friend.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block truncate font-mono text-[10.5px] text-subtle hover:text-primary hover:underline"
        >
          {friend.link}
        </a>
      </div>

      <div className="hidden shrink-0 items-center gap-1 lg:flex">
        {hidden && <StatusBadge tone="neutral">已隐藏</StatusBadge>}
        {!friend.inCircle && <StatusBadge tone="neutral">不入圈</StatusBadge>}
        {unreachable ? (
          <StatusBadge tone="danger">失联</StatusBadge>
        ) : friend.state?.crawlable === false ? (
          <StatusBadge tone="warning">RSS 不可用</StatusBadge>
        ) : friend.state ? (
          <StatusBadge tone="success">正常</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">未检测</StatusBadge>
        )}
        {(friend.archs ?? []).slice(0, 2).map((arch) => (
          <StatusBadge key={arch} tone="neutral">{arch}</StatusBadge>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 lg:hidden">
        {hidden ? (
          <StatusBadge tone="neutral">隐藏</StatusBadge>
        ) : unreachable ? (
          <StatusBadge tone="danger">失联</StatusBadge>
        ) : friend.state?.crawlable === false ? (
          <StatusBadge tone="warning">RSS</StatusBadge>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`编辑 ${friend.author}`}>
          <Pencil />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`更多操作：${friend.author}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onMoveUp}>
              <ArrowUp /> 上移
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMoveDown}>
              <ArrowDown /> 下移
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onToggleHidden}>
              {hidden ? <Eye /> : <EyeOff />}
              {hidden ? '恢复显示' : '隐藏'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}
