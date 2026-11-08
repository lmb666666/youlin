import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, HeartPulse, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar } from '@/components/common/avatar'
import { DataTable, type SortState } from '@/components/common/data-table'
import { EmptyState, ErrorState } from '@/components/common/page-state'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { SegmentedControl } from '@/components/common/segmented-control'
import { StatusBadge } from '@/components/common/status-badge'
import { api, type HealthFriend } from '@/lib/api'
import { useHealthQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { formatDateTime, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'
import { useQueryParam } from '@/lib/url-state'
import { csvCell } from '@/lib/csv'
import { downloadBlob } from '@/lib/download'
import { useJobStatus } from '@/lib/jobs'

type Filter = 'all' | 'abnormal' | 'unchecked'

const SORT_VALUE: Record<string, (friend: HealthFriend) => string | number> = {
  author: (friend) => friend.author,
  reachable: (friend) => (friend.state?.reachable === true ? 1 : friend.state?.reachable === false ? 0 : -1),
  crawlable: (friend) => (friend.state?.crawlable === true ? 1 : friend.state?.crawlable === false ? 0 : -1),
  backlink: (friend) => (friend.state?.backlink === true ? 1 : friend.state?.backlink === false ? 0 : -1),
  latency: (friend) => friend.state?.latencyMs ?? Number.MAX_SAFE_INTEGER,
  stale: (friend) => friend.state?.lastPostDaysAgo ?? Number.MAX_SAFE_INTEGER,
  checked: (friend) => friend.state?.checkedAt ?? '',
}

function isAbnormal(friend: HealthFriend): boolean {
  return (
    friend.state?.reachable === false ||
    friend.state?.crawlable === false ||
    (friend.state?.backlinkChecked === true && friend.state?.backlink === false)
  )
}

function reachableBadge(state: HealthFriend['state']) {
  if (!state || state.reachable === null) return <StatusBadge tone="neutral">未检测</StatusBadge>
  return state.reachable ? <StatusBadge tone="success">可达</StatusBadge> : <StatusBadge tone="danger">失联</StatusBadge>
}

function crawlableBadge(state: HealthFriend['state']) {
  if (!state || state.crawlable === null) return <StatusBadge tone="neutral">未检测</StatusBadge>
  return state.crawlable ? <StatusBadge tone="success">可解析</StatusBadge> : <StatusBadge tone="danger">不可解析</StatusBadge>
}

function backlinkBadge(state: HealthFriend['state']) {
  if (!state?.backlinkChecked) return <StatusBadge tone="neutral">未检测</StatusBadge>
  if (state.backlink === null) return <StatusBadge tone="neutral">未检测</StatusBadge>
  return state.backlink ? <StatusBadge tone="success">已检测</StatusBadge> : <StatusBadge tone="danger">未检测到</StatusBadge>
}

function latencyText(state: HealthFriend['state']): string {
  if (!state || state.reachable === false || state.latencyMs === null) return '—'
  if (state.latencyMs < 0) return '—'
  return `${(state.latencyMs / 1000).toFixed(2)}s`
}

function toCsv(friends: HealthFriend[]): string {
  const header = ['作者', '链接', 'feed', '可达', '可抓取', '反链', '延迟ms', 'HTTP状态', '最终域名', '失联起始', 'RSS不可用起始', '最近发文', '距今天数', '失败次数', '最后错误', '最后检查', '下次检查']
  const lines = friends.map((friend) => {
    const state = friend.state
    return [
      friend.author,
      friend.link,
      friend.feed ?? '',
      state?.reachable ?? '',
      state?.crawlable ?? '',
      state?.backlinkChecked ? (state.backlink === null ? '未检测' : state.backlink ? '是' : '否') : '未检测',
      state?.latencyMs ?? '',
      state?.httpStatus ?? '',
      state?.finalUrl ?? '',
      state?.unreachableSince ?? '',
      state?.rssUnavailableSince ?? '',
      state?.lastPostPublished ?? '',
      state?.lastPostDaysAgo ?? '',
      state?.failCount ?? 0,
      state?.lastError ?? '',
      state?.checkedAt ?? '',
      state?.nextCheckAt ?? '',
    ].map(csvCell).join(',')
  })
  return '\ufeff' + [header.map(csvCell).join(','), ...lines].join('\r\n')
}

export default function HealthPage() {
  const settings = useSettings()
  const client = useQueryClient()
  const healthQuery = useHealthQuery()
  const jobQuery = useJobStatus()
  const [filter, setFilter] = useQueryParam('filter', 'all')
  const [pageParam, setPageParam] = useQueryParam('page', '1')
  const [sortKey, setSortKey] = useQueryParam('sort', 'author')
  const [sortDir, setSortDir] = useQueryParam('dir', 'asc')
  const [selected, setSelected] = useState<HealthFriend | null>(null)

  const pageSize = Math.max(1, typeof settings['ui.pageSize'] === 'number' ? (settings['ui.pageSize'] as number) : 20)
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const fmt = (iso: string | null | undefined) => formatDateTime(iso, settingsDateTimeOptions(settings))
  const running = Boolean(jobQuery.data?.running)

  const run = useMutation({
    mutationFn: () => api<{ started: number }>('/api/admin/health/run', { method: 'POST' }),
    onSuccess: (result) => {
      toast.success(result.started > 0 ? `已开始体检 ${result.started} 个站点` : '没有需要体检的友链')
      void client.invalidateQueries({ queryKey: queryKeys.crawlStatus })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '触发失败'),
  })

  const friends = healthQuery.data?.friends ?? []
  const abnormal = friends.filter(isAbnormal).length
  const unchecked = friends.filter((friend) => !friend.state?.checkedAt).length
  const currentFilter: Filter = filter === 'abnormal' ? 'abnormal' : filter === 'unchecked' ? 'unchecked' : 'all'
  const filtered = currentFilter === 'all' ? friends : currentFilter === 'abnormal' ? friends.filter(isAbnormal) : friends.filter((friend) => !friend.state?.checkedAt)

  const sort: SortState = { key: sortKey, dir: sortDir === 'desc' ? 'desc' : 'asc' }
  const sorted = useMemo(() => {
    const getValue = SORT_VALUE[sort.key]
    if (!getValue) return filtered
    return [...filtered].sort((a, b) => {
      const av = getValue(a)
      const bv = getValue(b)
      const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'zh-CN')
      return sort.dir === 'asc' ? result : -result
    })
  }, [filtered, sort.key, sort.dir])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages)
  const rows = sorted.slice((current - 1) * pageSize, current * pageSize)

  function downloadCsv() {
    const blob = new Blob([toCsv(friends)], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, `youlin-health-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  if (healthQuery.isError) {
    return (
      <div className="grid min-w-0 gap-5">
        <PageHeader title="体检" description="可达性、RSS、反链与发文节奏。" />
        <ErrorState title="体检数据加载失败" error={healthQuery.error} onRetry={() => void healthQuery.refetch()} />
      </div>
    )
  }

  if (healthQuery.isPending) {
    return (
      <div className="grid gap-5">
        <PageHeader title="体检" description="可达性、RSS、反链与发文节奏。" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={`共 ${friends.length} 个源 · ${abnormal} 个异常 · ${unchecked} 个未检测`}
        title="体检"
        description="RSS 优先逐站检测，结果同步到公开接口。"
        actions={
          <>
            <Button variant="outline" onClick={downloadCsv} disabled={friends.length === 0}>
              <Download /> 导出 CSV
            </Button>
            <Button onClick={() => run.mutate()} disabled={running || run.isPending}>
              <Play /> {running ? '体检进行中…' : run.isPending ? '启动中…' : '全量检测'}
            </Button>
          </>
        }
      />

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-base"><HeartPulse className="size-4 text-primary" /> 站点体检</h2>
            <p className="mt-1 text-[11px] text-subtle">点击表头排序；行尾查看完整状态。</p>
          </div>
          <SegmentedControl
            ariaLabel="筛选体检结果"
            value={currentFilter}
            onChange={setFilter}
            items={[
              { value: 'all', label: '全部', count: friends.length },
              { value: 'abnormal', label: '异常', count: abnormal },
              { value: 'unchecked', label: '未检测', count: unchecked },
            ]}
          />
        </div>

        {friends.length === 0 ? (
          <EmptyState compact icon={HeartPulse} title="还没有友链" description="先添加友链，体检结果会显示在这里。" />
        ) : filtered.length === 0 ? (
          <EmptyState compact icon={HeartPulse} title="没有匹配的源" description="换一个筛选条件试试。" />
        ) : (
          <div className="grid gap-3 p-3 sm:p-4">
            <DataTable
              rows={rows}
              getRowKey={(friend) => friend.id}
              sort={sort}
              onSortChange={(next) => {
                setSortKey(next.key)
                setSortDir(next.dir)
              }}
              columns={[
                {
                  key: 'author',
                  header: '站点',
                  sortValue: SORT_VALUE.author,
                  cell: (friend) => (
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={friend.author} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{friend.author}</p>
                        <a href={friend.link} target="_blank" rel="noreferrer" className="block truncate font-mono text-[10px] text-subtle hover:text-primary hover:underline">
                          {friend.link}
                        </a>
                      </div>
                    </div>
                  ),
                },
                { key: 'reachable', header: '可达', sortValue: SORT_VALUE.reachable, cell: (friend) => reachableBadge(friend.state) },
                { key: 'crawlable', header: 'RSS', sortValue: SORT_VALUE.crawlable, cell: (friend) => crawlableBadge(friend.state) },
                { key: 'backlink', header: '反链', sortValue: SORT_VALUE.backlink, cell: (friend) => backlinkBadge(friend.state) },
                { key: 'latency', header: '延迟', sortValue: SORT_VALUE.latency, cell: (friend) => <span className="font-mono">{latencyText(friend.state)}</span>, hideOnMobile: true },
                {
                  key: 'finalUrl',
                  header: '最终域名',
                  cell: (friend) =>
                    friend.state?.finalUrl ? (
                      <a href={friend.state.finalUrl} target="_blank" rel="noreferrer" className="block max-w-44 truncate font-mono text-[10.5px] hover:text-primary hover:underline">
                        {friend.state.finalUrl}
                      </a>
                    ) : '—',
                  hideOnMobile: true,
                },
                { key: 'stale', header: '最近发文', sortValue: SORT_VALUE.stale, cell: (friend) => friend.state?.lastPostDaysAgo === null || friend.state?.lastPostDaysAgo === undefined ? '—' : `${friend.state.lastPostDaysAgo} 天前`, hideOnMobile: true },
                { key: 'checked', header: '检查时间', sortValue: SORT_VALUE.checked, cell: (friend) => fmt(friend.state?.checkedAt), hideOnMobile: true },
              ]}
              actions={(friend) => (
                <Button variant="ghost" size="icon-sm" onClick={() => setSelected(friend)} aria-label={`查看 ${friend.author} 的体检详情`}>
                  <Eye />
                </Button>
              )}
            />
            <Pagination page={current} pageSize={pageSize} total={sorted.length} onPageChange={(next) => setPageParam(String(next))} />
          </div>
        )}
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.author} 的体检详情</DialogTitle>
            <DialogDescription>最近一次检查的完整状态。</DialogDescription>
          </DialogHeader>
          {selected && <HealthDetail friend={selected} fmt={fmt} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function HealthDetail({ friend, fmt }: { friend: HealthFriend; fmt: (value: string | null | undefined) => string }) {
  const state = friend.state
  const rows: [string, ReactNode][] = [
    ['站点链接', <a key="link" href={friend.link} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{friend.link}</a>],
    ['RSS', friend.feed ?? '—'],
    ['可达', reachableBadge(state)],
    ['RSS 可解析', crawlableBadge(state)],
    ['反链', backlinkBadge(state)],
    ['延迟', latencyText(state)],
    ['HTTP 状态', state?.httpStatus ?? '—'],
    ['最终域名', state?.finalUrl ?? '—'],
    ['最近发文', state?.lastPostPublished ? `${fmt(state.lastPostPublished)}${state.lastPostDaysAgo !== null ? `（${state.lastPostDaysAgo} 天前）` : ''}` : '—'],
    ['失联起始', fmt(state?.unreachableSince)],
    ['RSS 不可用起始', fmt(state?.rssUnavailableSince)],
    ['连续失败', state?.failCount ?? 0],
    ['最后成功', fmt(state?.lastOkAt)],
    ['最后检查', fmt(state?.checkedAt)],
    ['下次检查', fmt(state?.nextCheckAt)],
  ]

  return (
    <div className="grid gap-3">
      <dl className="grid gap-2 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            <dt className="text-subtle">{label}</dt>
            <dd className="min-w-0 break-words text-muted-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {state?.lastError && (
        <div className="rounded-lg border border-danger-border bg-danger-bg p-3">
          <p className="text-[11px] font-medium text-danger">最后错误</p>
          <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">{state.lastError}</p>
        </div>
      )}
    </div>
  )
}
