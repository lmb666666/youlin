import { Activity, HeartPulse, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApiMutation } from '@/lib/mutations'
import { api } from '@/lib/api'
import { jobKindLabel, jobProgress, useJobStatus } from '@/lib/jobs'
import { queryKeys } from '@/lib/query'
import { StatusBadge } from '@/components/common/status-badge'
import { cn } from '@/lib/utils'

export function JobStatus() {
  const { data, isError, refetch } = useJobStatus()

  const crawl = useApiMutation<{ started: number }, void>({
    mutationFn: () => api('/api/admin/crawl', { method: 'POST' }),
    invalidate: [queryKeys.crawlStatus],
    successMessage: (result) => (result.started > 0 ? `已开始抓取 ${result.started} 个源` : '没有可抓取的源'),
  })

  const health = useApiMutation<{ started: number }, void>({
    mutationFn: () => api('/api/admin/health/run', { method: 'POST' }),
    invalidate: [queryKeys.crawlStatus],
    successMessage: (result) => (result.started > 0 ? `已开始体检 ${result.started} 个源` : '没有可体检的源'),
  })

  const running = Boolean(data?.running)
  const round = data?.round
  const kind = jobKindLabel(round?.kind)
  const percent = round ? jobProgress(round.done, round.total) : 0

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('gap-2', running && 'text-primary')}
          aria-label="查看任务状态"
        >
          {running ? <Activity className="animate-pulse" /> : <Activity className="text-subtle" />}
          <span className="hidden text-xs sm:inline">
            {running && round ? `${kind} ${round.done}/${round.total}` : '任务'}
          </span>
          {running && <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-medium">任务状态</p>
            <p className="text-xs text-subtle">抓取与体检共用同一轮转锁</p>
          </div>
          {running ? <StatusBadge tone="info">进行中</StatusBadge> : <StatusBadge tone="success">空闲</StatusBadge>}
        </div>

        <div className="grid gap-3 px-4 py-3 text-xs">
          {isError && (
            <div className="flex items-center justify-between gap-2 text-danger">
              <span>任务状态读取失败</span>
              <Button variant="ghost" size="sm" onClick={() => void refetch()}>
                重试
              </Button>
            </div>
          )}

          {running && round ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{kind}进度</span>
                <span className="font-mono tabular-nums">{round.done} / {round.total}</span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${kind}进度`}
              >
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
              {data?.stale && <p className="text-warning">上一轮已超时，可能是进程被中断；可重新发起。</p>}
            </>
          ) : (
            <div className="grid gap-1.5 text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>待检查源</span>
                <span className="font-mono tabular-nums">{data?.dueCount ?? '—'} / {data?.activeCount ?? '—'}</span>
              </div>
              <p className="text-subtle">抓取每轮只处理一批源，完成一轮后会自动刷新数据。</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t px-4 py-3">
          <Button size="sm" variant="outline" onClick={() => crawl.mutate()} disabled={running || crawl.isPending}>
            <RefreshCw className={cn(crawl.isPending && 'animate-spin')} />
            抓取一轮
          </Button>
          <Button size="sm" variant="ghost" onClick={() => health.mutate()} disabled={running || health.isPending}>
            <HeartPulse className={cn(health.isPending && 'animate-pulse')} />
            全量体检
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
