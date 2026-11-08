import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  compact = false,
  className,
}: {
  title: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 text-center', compact ? 'py-8' : 'py-12', className)}>
      <span className="mb-1 grid size-10 place-items-center rounded-xl border bg-secondary text-subtle">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-xs leading-relaxed text-subtle">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = '加载失败',
  error,
  onRetry,
  className,
}: {
  title?: string
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '请检查服务状态后重试。'
  return (
    <Card className={cn('border-danger-border', className)}>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <span className="mb-1 grid size-10 place-items-center rounded-xl border border-danger-border bg-danger-bg text-danger">
          <AlertTriangle className="size-5" />
        </span>
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCw /> 重试
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function PageLoading({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-subtle">
      <LoaderCircle className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-2.5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded-full bg-secondary"
          style={{ width: `${[92, 72, 84, 58, 76][i % 5]}%` }}
        />
      ))}
    </div>
  )
}
