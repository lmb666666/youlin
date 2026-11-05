import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Hammer, Newspaper, Play, RefreshCw, Rss, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useArticlesQuery, useCrawlStatusQuery, useHealthQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { useQueryErrorToast } from '@/lib/query-error'
import { formatDateTime, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'

export default function CirclePage() {
  const settings = useSettings()
  const fmt = (iso: string | null | undefined) => formatDateTime(iso, settingsDateTimeOptions(settings))
  const client = useQueryClient()
  const healthQuery = useHealthQuery()
  const statusQuery = useCrawlStatusQuery()
  const articlesQuery = useArticlesQuery()
  const [singleBusy, setSingleBusy] = useState<number | null>(null)
  const [rebuildBusy, setRebuildBusy] = useState(false)
  const rebuildEnabled = settings['rebuild.enabled'] === true

  useQueryErrorToast(healthQuery.error ?? statusQuery.error ?? articlesQuery.error)

  const status = statusQuery.data
  const wasRunning = useRef(false)
  useEffect(() => {
    // 轮询检测到本轮结束：刷新体检/文章列表（状态本身已由 query 更新）
    if (wasRunning.current && status && !status.running) {
      void client.invalidateQueries({ queryKey: queryKeys.health })
      void client.invalidateQueries({ queryKey: queryKeys.articles })
    }
    wasRunning.current = Boolean(status?.running)
  }, [status, client])

  const crawlMutation = useMutation({
    mutationFn: () => api<{ started: number }>('/api/admin/crawl', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.started > 0 ? `已开始抓取 ${r.started} 个源` : '没有待抓取的友链')
      void client.invalidateQueries({ queryKey: queryKeys.crawlStatus })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '触发失败'),
  })

  const rebuildMutation = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; provider: string }>('/api/admin/rebuild', {
        method: 'POST',
        body: JSON.stringify({ reason: 'manual' }),
      }),
    onMutate: () => setRebuildBusy(true),
    onSettled: () => setRebuildBusy(false),
    onSuccess: (r) => toast.success(`已触发重建（${r.provider}）`),
    onError: (err) => toast.error(err instanceof Error ? err.message : '触发失败'),
  })

  const crawlOneMutation = useMutation({
    mutationFn: (id: number) => api<{ outcome: string }>(`/api/admin/crawl/${id}`, { method: 'POST' }),
    onMutate: (id) => setSingleBusy(id),
    onSettled: () => setSingleBusy(null),
    onSuccess: (r) => {
      const text = { ok: '成功', notModified: '无更新（304）', failed: '失败', skipped: '跳过' }[r.outcome] ?? r.outcome
      toast.info(`抓取结果：${text}`)
      void client.invalidateQueries({ queryKey: queryKeys.health })
      void client.invalidateQueries({ queryKey: queryKeys.articles })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '抓取失败'),
  })

  const deleteArticleMutation = useMutation({
    mutationFn: (id: number) => api(`/api/admin/articles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('文章已删除')
      void client.invalidateQueries({ queryKey: queryKeys.articles })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '删除失败'),
  })

  if (healthQuery.isPending || statusQuery.isPending || articlesQuery.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const friends = healthQuery.data?.friends ?? []
  const articles = (articlesQuery.data?.articles ?? []).slice(0, 20)
  const sources = friends.filter((f) => f.status === 'active' && f.inCircle && f.feed)
  const progress = status?.round && status.round.total > 0 ? Math.round((status.round.done / status.round.total) * 100) : 0
  if (!status) return <p className="text-sm text-muted-foreground">数据加载失败，请刷新重试。</p>

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">朋友圈</h1>
          <p className="text-sm text-muted-foreground">
            每 5 分钟抓一批；{status.dueCount}/{status.activeCount} 个源待检查。
          </p>
        </div>
        <div className="flex gap-2">
          {rebuildEnabled && (
            <Button variant="outline" onClick={() => rebuildMutation.mutate()} disabled={rebuildBusy}>
              <Hammer /> {rebuildBusy ? '触发中…' : '重建站点'}
            </Button>
          )}
          <Button onClick={() => crawlMutation.mutate()} disabled={crawlMutation.isPending || status.running}>
            <Play /> {crawlMutation.isPending || status.running ? '抓取进行中…' : '手动抓取一轮'}
          </Button>
        </div>
      </div>

      {status.running && status.round && (
        <Card>
          <CardContent className="pt-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>
                {status.round.kind === 'health' ? '体检进行中' : '抓取进行中'}
              </span>
              <span className="text-muted-foreground">
                {status.round.done}/{status.round.total} · {progress}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Rss className="size-4" /> 抓取状态（{sources.length} 个源）
          </CardTitle>
          <CardDescription>按下次检查时间排序。</CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有可抓取的源：在「友链」页补上 feed 即可。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>源</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近发文</TableHead>
                  <TableHead>最近成功</TableHead>
                  <TableHead>下次检查</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...sources]
                  .sort((a, b) => (a.state?.nextCheckAt ?? '') < (b.state?.nextCheckAt ?? '') ? -1 : 1)
                  .map((f) => {
                    const st = f.state
                    const failed = st?.reachable === false || st?.crawlable === false
                    return (
                      <TableRow key={f.id}>
                        <TableCell>
                          <div className="font-medium">{f.author}</div>
                          <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">
                            {f.link}
                          </a>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {failed ? <Badge variant="destructive">失败</Badge> : <Badge variant="secondary">正常</Badge>}
                            {st?.crawlable === false && f.feed && <Badge variant="outline">RSS 不可用</Badge>}
                            {st && st.failCount > 0 && <Badge variant="outline">连败 {st.failCount}</Badge>}
                            {st?.lastError && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help text-xs text-muted-foreground">错误详情</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-72 text-xs">{st.lastError}</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{fmt(st?.lastPostPublished)}</TableCell>
                        <TableCell className="text-xs">{fmt(st?.lastOkAt)}</TableCell>
                        <TableCell className="text-xs">{fmt(st?.nextCheckAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" className="size-8" disabled={singleBusy !== null} onClick={() => crawlOneMutation.mutate(f.id)} aria-label="抓取此源">
                            <RefreshCw className={`size-3.5 ${singleBusy === f.id ? 'animate-spin' : ''}`} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Newspaper className="size-4" /> 最近文章（{articles.length}）
          </CardTitle>
          <CardDescription>按发布时间倒序，过期文章自动清理。</CardDescription>
        </CardHeader>
        <CardContent>
          {articles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有抓到文章</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead className="hidden sm:table-cell">来源</TableHead>
                  <TableHead className="hidden md:table-cell">发布时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {articles.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-96">
                      <a href={a.link} target="_blank" rel="noopener noreferrer" className="block truncate font-medium hover:underline">
                        {a.title}
                      </a>
                    </TableCell>
                    <TableCell className="hidden text-xs sm:table-cell">{a.friendAuthor}</TableCell>
                    <TableCell className="hidden text-xs md:table-cell">{fmt(a.publishedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => deleteArticleMutation.mutate(a.id)} aria-label="删除文章">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
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
