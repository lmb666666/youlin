import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CrawlStatus } from './api'
import { invalidateAfterJob, queryKeys } from './query'

/** 全局唯一的任务状态轮询：进行中 1.5s 一次，结束即停。 */
export function useJobStatus() {
  return useQuery({
    queryKey: queryKeys.crawlStatus,
    queryFn: () => api<CrawlStatus>('/api/admin/crawl/status'),
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
    staleTime: 0,
  })
}

/** 挂在应用外壳上：任务从 running 变为结束触发一次数据刷新。 */
export function useJobWatcher() {
  const client = useQueryClient()
  const { data } = useJobStatus()
  const running = data?.running
  const wasRunning = useRef(false)

  useEffect(() => {
    if (wasRunning.current && running === false) {
      invalidateAfterJob(client)
    }
    wasRunning.current = Boolean(running)
  }, [running, client])
}

export function jobKindLabel(kind: string | undefined): string {
  if (kind === 'health') return '体检'
  if (kind === 'crawl') return '抓取'
  return '任务'
}

export function jobProgress(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}
