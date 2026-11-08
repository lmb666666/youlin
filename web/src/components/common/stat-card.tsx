import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'default',
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'warning' | 'danger'
  className?: string
}) {
  return (
    <Card className={cn('gap-0 py-0', className)}>
      <CardContent className="flex flex-col gap-3 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              'grid size-7 place-items-center rounded-lg border bg-secondary text-muted-foreground',
              tone === 'warning' && 'border-warning-border bg-warning-bg text-warning',
              tone === 'danger' && 'border-danger-border bg-danger-bg text-danger',
            )}
          >
            <Icon className="size-3.5" />
          </span>
          {label}
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="font-serif text-3xl leading-none tabular-nums">{value}</span>
          {sub && <span className="text-[11px] text-subtle">{sub}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
