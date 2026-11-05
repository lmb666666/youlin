import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, HeartPulse, Play } from 'lucide-react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/query-error'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type HealthFriend } from '@/lib/api'
import { downloadBlob } from '@/lib/download'
import { useCrawlStatusQuery, useHealthQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { useQueryErrorToast } from '@/lib/query-error'
import { csvCell } from '@/lib/csv'
import { formatDateTime, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'

function badgeFor(v: boolean | null | undefined, trueText: string, falseText: string, unknownText = '未检测') {
  if (v === true) return <Badge variant="secondary">{trueText}</Badge>
  if (v === false) return <Badge variant="destructive">{falseText}</Badge>
  return <Badge variant="outline">{unknownText}</Badge>
}

const col = createColumnHelper<HealthFriend>()

function createColumns(fmt: (iso: string | null | undefined) => string) {
  return [
  col.accessor('author', {
    header: '站点',
    cell: (c) => (
      <div>
        <div className="font-medium">
          {c.getValue()}
          {!c.row.original.inCircle && <span className="ml-1 text-xs text-muted-foreground">（不入圈）</span>}
        </div>
        <a href={c.row.original.link} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">
          {c.row.original.link}
        </a>
      </div>
    ),
  }),
  col.accessor((r) => r.state?.reachable ?? null, {
    id: 'reachable',
    header: '可达',
    cell: (c) => badgeFor(c.getValue(), '可达', '失联'),
  }),
  col.accessor((r) => r.state?.crawlable ?? null, {
    id: 'crawlable',
    header: '可抓取',
    cell: (c) => badgeFor(c.getValue(), 'RSS 正常', 'RSS 不可用'),
  }),
  col.accessor((r) => r.state?.backlink ?? null, {
    id: 'backlink',
    header: '反链',
    cell: (c) => badgeFor(c.getValue(), '有反链', '无反链'),
  }),
  col.accessor((r) => r.state?.latencyMs ?? null, {
    id: 'latency',
    header: '延迟',
    cell: (c) => {
      const v = c.getValue()
      if (v === null) return '—'
      return v < 0 ? '—' : `${(v / 1000).toFixed(2)}s`
    },
  }),
  col.accessor((r) => r.state?.finalUrl ?? null, {
    id: 'finalUrl',
    header: '最终域名',
    cell: (c) => {
      const v = c.getValue()
      if (!v) return '—'
      return (
        <a href={v} target="_blank" rel="noopener noreferrer" className="block max-w-44 truncate text-xs hover:underline" title={v}>
          {v}
        </a>
      )
    },
  }),
  col.accessor((r) => r.state?.lastPostDaysAgo ?? null, {
    id: 'stale',
    header: '最近发文',
    cell: (c) => {
      const v = c.getValue()
      return v === null ? '—' : `${v} 天前`
    },
  }),
  col.accessor((r) => r.state?.unreachableSince ?? null, {
    id: 'unreachable',
    header: '失联起始',
    cell: (c) => fmt(c.getValue()),
  }),
  col.accessor((r) => r.state?.checkedAt ?? null, {
    id: 'checked',
    header: '最后检查',
    cell: (c) => fmt(c.getValue()),
  }),
  ]
}

function toCsv(friends: HealthFriend[]): string {
  const header = ['作者', '链接', 'feed', '可达', '可抓取', '反链', '延迟ms', 'HTTP状态', '最终域名', '失联起始', 'RSS不可用起始', '最近发文', '距今天数', '失败次数', '最后错误', '最后检查', '下次检查']
  const lines = friends.map((f) => {
    const s = f.state
    return [
      f.author, f.link, f.feed ?? '', s?.reachable ?? '', s?.crawlable ?? '',
      s?.backlinkChecked ? (s.backlink === null ? '未检测' : s.backlink ? '是' : '否') : '未检测',
      s?.latencyMs ?? '', s?.httpStatus ?? '', s?.finalUrl ?? '',
      s?.unreachableSince ?? '', s?.rssUnavailableSince ?? '',
      s?.lastPostPublished ?? '', s?.lastPostDaysAgo ?? '',
      s?.failCount ?? 0, s?.lastError ?? '', s?.checkedAt ?? '', s?.nextCheckAt ?? '',
    ]
      .map(csvCell)
      .join(',')
  })
  // BOM 让 Excel 正确识别 UTF-8
  return '\ufeff' + [header.map(csvCell).join(','), ...lines].join('\r\n')
}

export default function HealthPage() {
  const client = useQueryClient()
  const healthQuery = useHealthQuery()
  const [running, setRunning] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const statusQuery = useCrawlStatusQuery(running)
  const attempted = useRef(0)
  const sawRunning = useRef(false)
  const baselineRound = useRef<string | null>(null)
  useQueryErrorToast(healthQuery.error)

  useEffect(() => {
    if (!running) return
    const s = statusQuery.data
    if (!s) return
    if (s.running) {
      sawRunning.current = true
      return
    }
    // 上一轮结束后 round.kind 仍是 health；用启动时记录的 startedAt 区分新旧轮次（避免时钟偏差）
    const thisRound = s.round?.kind === 'health' && s.round.startedAt !== baselineRound.current
    if (sawRunning.current || thisRound) {
      setRunning(false)
      sawRunning.current = false
      toast.success('体检完成')
      void client.invalidateQueries({ queryKey: queryKeys.health })
      return
    }
    // 未见体检轮转记录（可能启动竞态）：有限次重试后放弃
    attempted.current++
    if (attempted.current >= 15) {
      setRunning(false)
      toast.info('体检状态未知，请手动刷新')
      void client.invalidateQueries({ queryKey: queryKeys.health })
    }
  }, [running, statusQuery.data, client])

  const runMutation = useMutation({
    mutationFn: () => api<{ started: number }>('/api/admin/health/run', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.started === 0) {
        toast.info('没有需要体检的友链')
        return
      }
      toast.success(`已开始体检 ${r.started} 个站点`)
      attempted.current = 0
      sawRunning.current = false
      baselineRound.current = statusQuery.data?.round?.startedAt ?? null
      setRunning(true)
      void client.invalidateQueries({ queryKey: queryKeys.crawlStatus })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '触发失败'),
  })

  function downloadCsv() {
    const friends = healthQuery.data?.friends
    if (!friends) return
    const blob = new Blob([toCsv(friends)], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, `youlin-health-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const settings = useSettings()
  const fmt = useCallback(
    (iso: string | null | undefined) => formatDateTime(iso, settingsDateTimeOptions(settings)),
    [settings],
  )
  const columns = useMemo(() => createColumns(fmt), [fmt])
  const friends = healthQuery.data?.friends ?? []
  const pageSize = Math.max(1, typeof settings['ui.pageSize'] === 'number' ? (settings['ui.pageSize'] as number) : 20)
  // 分页大小或行数变化后，页码可能越界（分页器会隐藏，届时无从翻回），这里夹住
  const pageCount = Math.max(1, Math.ceil(friends.length / pageSize))
  const pageIndex = Math.min(pagination.pageIndex, pageCount - 1)
  const table = useReactTable({
    data: friends,
    columns,
    state: { sorting, pagination: { pageSize, pageIndex } },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  if (healthQuery.isError) {
    return <QueryError message={healthQuery.error instanceof Error ? healthQuery.error.message : '体检数据加载失败'} onRetry={() => void healthQuery.refetch()} />
  }

  if (healthQuery.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">体检</h1>
          <p className="text-sm text-muted-foreground">
            RSS 优先逐站检测，结果同步到公开接口。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadCsv} disabled={friends.length === 0}>
            <Download /> 导出 CSV
          </Button>
          <Button onClick={() => runMutation.mutate()} disabled={running || runMutation.isPending}>
            <Play /> {running || runMutation.isPending ? '体检进行中…' : '全量检测'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="size-4" /> 全部友链（{friends.length}）
          </CardTitle>
          <CardDescription>失联源排在前面，点击表头排序。</CardDescription>
        </CardHeader>
        <CardContent>
          {friends.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有友链。</p>
          ) : (
            <>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id} className="cursor-pointer select-none" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {table.getPageCount() > 1 && (
              <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                <span>共 {friends.length} 条 · 第 {table.getState().pagination.pageIndex + 1} / {table.getPageCount()} 页</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>上一页</Button>
                  <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>下一页</Button>
                </div>
              </div>
            )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
