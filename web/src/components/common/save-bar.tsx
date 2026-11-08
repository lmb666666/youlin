import { Button } from '@/components/ui/button'

export function SaveBar({
  count,
  onSave,
  onDiscard,
  pending = false,
}: {
  count: number
  onSave: () => void
  onDiscard: () => void
  pending?: boolean
}) {
  if (count <= 0) return null
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
      <span className="text-xs text-muted-foreground">
        <strong className="font-medium text-foreground">{count}</strong> 项未保存
      </span>
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onDiscard} disabled={pending}>
        放弃
      </Button>
      <Button size="sm" onClick={onSave} disabled={pending}>
        {pending ? '保存中…' : '保存更改'}
      </Button>
    </div>
  )
}
