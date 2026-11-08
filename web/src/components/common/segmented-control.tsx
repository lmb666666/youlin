import { cn } from '@/lib/utils'

export interface SegmentedItem {
  value: string
  label: string
  count?: number
}

/** 轻量分段控件：用于筛选（aria-pressed），不是页面级 tab。 */
export function SegmentedControl({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: SegmentedItem[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('inline-flex flex-wrap gap-0.5 rounded-lg border bg-secondary p-0.5', className)}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
              active ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="font-mono text-[10px] text-subtle">{item.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
