import { cn } from '@/lib/utils'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const TONE: Record<BadgeTone, string> = {
  success: 'border-success-border bg-success-bg text-success',
  warning: 'border-warning-border bg-warning-bg text-warning',
  danger: 'border-danger-border bg-danger-bg text-danger',
  info: 'border-info-border bg-info-bg text-info',
  neutral: 'border-border bg-secondary text-muted-foreground',
}

export function StatusBadge({
  tone = 'neutral',
  children,
  className,
  icon: Icon,
}: {
  tone?: BadgeTone
  children: React.ReactNode
  className?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none',
        TONE[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  )
}
