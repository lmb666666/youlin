import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Eye, EyeOff, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Friend } from '@/lib/api'

export function SortableFriendRow(props: {
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
