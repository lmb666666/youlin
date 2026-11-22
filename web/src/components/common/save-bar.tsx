import { Button } from '@/components/ui/button'

export function SaveBar({
  count,
  onSave,
  onDiscard,
  pending = false,
  disabled = false,
}: {
  count: number
  onSave: () => void
  onDiscard: () => void
  pending?: boolean
  /** 与页头保存按钮同口径：存在非法 JSON 等阻断条件时禁用保存 */
  disabled?: boolean
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
      <Button size="sm" onClick={onSave} disabled={pending || disabled}>
        {pending ? '保存中…' : '保存更改'}
      </Button>
    </div>
  )
}
