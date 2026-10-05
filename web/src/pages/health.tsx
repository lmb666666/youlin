import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, HeartPulse, Play } from 'lucide-react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type HealthFriend } from '@/lib/api'

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function badgeFor(v: boolean | null | undefined, trueText: string, falseText: string, unknownText = '未检测') {
  if (v === true) return <Badge variant="secondary">{trueText}</Badge>
  if (v === false) return <Badge variant="destructive">{falseText}</Badge>
  return <Badge variant="outline">{unknownText}</Badge>
}

const col = createColumnHelper<HealthFriend>()

const columns = [
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

function toCsv(friends: HealthFriend[]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    return `"${s.replaceAll('"', '""')}"`
  }
  const header = ['作者', '链接', 'feed', '可达', '可抓取', '反链', '延迟ms', 'HTTP状态', '失联起始', 'RSS不可用起始', '最近发文', '距今天数', '失败次数', '最后错误', '最后检查', '下次检查']
  const lines = friends.map((f) => {
    const s = f.state
    return [
      f.author, f.link, f.feed ?? '', s?.reachable ?? '', s?.crawlable ?? '',
      s?.backlinkChecked ? (s.backlink ? '是' : '否') : '未检测',
      s?.latencyMs ?? '', s?.httpStatus ?? '',
      s?.unreachableSince ?? '', s?.rssUnavailableSince ?? '',
      s?.lastPostPublished ?? '', s?.lastPostDaysAgo ?? '',
      s?.failCount ?? 0, s?.lastError ?? '', s?.checkedAt ?? '', s?.nextCheckAt ?? '',
    ]
      .map(esc)
      .join(',')
  })
  // BOM 让 Excel 正确识别 UTF-8
  return '\ufeff' + [header.map(esc).join(','), ...lines].join('\r\n')
}

export default function HealthPage() {
  const [friends, setFriends] = useState<HealthFriend[] | null>(null)
  const [running, setRunning] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const pollRef = useRef<number | null>(null)

  const reload = useCallback(async () => {
    try {
      const h = await api<{ friends: HealthFriend[] }>('/api/admin/health')
      setFriends(h.friends)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [])

  const attempts = useRef(0)

  const pollStatus = useCallback(async () => {
    try {
      const s = await api<{ running: boolean; round: { kind: string; done: number; total: number } | null }>(
        '/api/admin/crawl/status',
      )
      if (s.running) return // 任何轮转运行中都继续等（不区分 kind，避免把 crawl 轮转误判为完成）
      attempts.current++
      if (s.round?.kind === 'health') {
        setRunning(false)
        if (pollRef.current) {
          window.clearInterval(pollRef.current)
          pollRef.current = null
          toast.success('体检完成')
          void reload()
        }
        return
      }
      // 未见体检轮转记录（可能启动竞态）：有限次重试后放弃
      if (attempts.current >= 15) {
        setRunning(false)
        if (pollRef.current) {
          window.clearInterval(pollRef.current)
          pollRef.current = null
          toast.info('体检已结束或状态未知，请手动刷新')
          void reload()
        }
      }
    } catch { /* 忽略轮询错误 */ }
  }, [reload])

  useEffect(() => {
    void reload()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [reload])

  async function runAll() {
    if (running) return
    try {
      const r = await api<{ started: number }>('/api/admin/health/run', { method: 'POST' })
      if (r.started === 0) {
        toast.info('没有需要体检的友链')
        return
      }
      toast.success(`已开始体检 ${r.started} 个站点，完成后自动刷新`)
      attempts.current = 0
      setRunning(true)
      pollRef.current = window.setInterval(() => void pollStatus(), 1500)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败')
    }
  }

  function downloadCsv() {
    if (!friends) return
    const blob = new Blob([toCsv(friends)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `youlin-health-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const table = useReactTable({
    data: friends ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (!friends) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">体检</h1>
          <p className="text-sm text-muted-foreground">
            三路检测（RSS 优先 → 首页兜底 → 状态 API）；结果输出到接口一的 health 字段。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadCsv} disabled={friends.length === 0}>
            <Download /> 导出 CSV
          </Button>
          <Button onClick={() => void runAll()} disabled={running}>
            <Play /> {running ? '体检进行中…' : '全量检测'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="size-4" /> 全部友链（{friends.length}）
          </CardTitle>
          <CardDescription>点击表头排序；失联源排在前面。</CardDescription>
        </CardHeader>
        <CardContent>
          {friends.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有友链。</p>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
