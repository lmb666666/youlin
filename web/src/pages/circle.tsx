import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Hammer, Newspaper, Play, RefreshCw, Rss, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { api, type ArticleRow, type CrawlStatus, type HealthFriend } from '@/lib/api'

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

export default function CirclePage() {
  const [friends, setFriends] = useState<HealthFriend[] | null>(null)
  const [status, setStatus] = useState<CrawlStatus | null>(null)
  const [articles, setArticles] = useState<ArticleRow[]>([])
  const [busy, setBusy] = useState(false)
  const [singleBusy, setSingleBusy] = useState<number | null>(null)
  const [rebuildEnabled, setRebuildEnabled] = useState(false)
  const [rebuildBusy, setRebuildBusy] = useState(false)
  const pollRef = useRef<number | null>(null)

  const reload = useCallback(async () => {
    try {
      const [h, s, a, cfg] = await Promise.all([
        api<{ friends: HealthFriend[] }>('/api/admin/health'),
        api<CrawlStatus>('/api/admin/crawl/status'),
        api<{ articles: ArticleRow[] }>('/api/admin/articles'),
        api<{ values: Record<string, unknown> }>('/api/admin/settings'),
      ])
      setFriends(h.friends)
      setStatus(s)
      setArticles(a.articles.slice(0, 20))
      setRebuildEnabled(cfg.values['rebuild.enabled'] === true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [reload])

  // 全量轮转进行中 → 轮询进度
  useEffect(() => {
    if (!status?.running) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
        void reload()
      }
      return
    }
    if (pollRef.current) return
    pollRef.current = window.setInterval(() => {
      void api<CrawlStatus>('/api/admin/crawl/status')
        .then(setStatus)
        .catch(() => {})
    }, 1500)
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [status?.running, reload])

  async function triggerCrawl() {
    if (busy) return
    setBusy(true)
    try {
      const r = await api<{ started: number }>('/api/admin/crawl', { method: 'POST' })
      toast.success(r.started > 0 ? `已开始抓取 ${r.started} 个源` : '没有待抓取的友链')
      const s = await api<CrawlStatus>('/api/admin/crawl/status')
      setStatus(s)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败')
    } finally {
      setBusy(false)
    }
  }

  async function triggerRebuild() {
    if (rebuildBusy) return
    setRebuildBusy(true)
    try {
      const r = await api<{ ok: boolean; provider: string }>('/api/admin/rebuild', { method: 'POST', body: JSON.stringify({ reason: 'manual' }) })
      toast.success(`已触发重建（${r.provider}）`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败')
    } finally {
      setRebuildBusy(false)
    }
  }

  async function crawlOne(id: number) {
    if (singleBusy !== null) return
    setSingleBusy(id)
    try {
      const r = await api<{ outcome: string }>(`/api/admin/crawl/${id}`, { method: 'POST' })
      const text = { ok: '成功', notModified: '无更新（304）', failed: '失败', skipped: '跳过' }[r.outcome] ?? r.outcome
      toast.info(`抓取结果：${text}`)
      void reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '抓取失败')
    } finally {
      setSingleBusy(null)
    }
  }

  async function deleteArticle(id: number) {
    try {
      await api(`/api/admin/articles/${id}`, { method: 'DELETE' })
      toast.success('文章已删除')
      void reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  if (!friends || !status) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const sources = friends.filter((f) => f.status === 'active' && f.inCircle && f.feed)
  const progress = status.round && status.round.total > 0 ? Math.round((status.round.done / status.round.total) * 100) : 0

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">朋友圈</h1>
          <p className="text-sm text-muted-foreground">
            Cron 每 5 分钟轮转一批（默认 3 站）；{status.dueCount}/{status.activeCount} 个源等待检查。
          </p>
        </div>
        <div className="flex gap-2">
          {rebuildEnabled && (
            <Button variant="outline" onClick={() => void triggerRebuild()} disabled={rebuildBusy}>
              <Hammer /> {rebuildBusy ? '触发中…' : '重建站点'}
            </Button>
          )}
          <Button onClick={() => void triggerCrawl()} disabled={busy || status.running}>
            <Play /> {status.running ? '抓取进行中…' : '手动抓取一轮'}
          </Button>
        </div>
      </div>

      {status.running && status.round && (
        <Card>
          <CardContent className="pt-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>
                {status.round.kind === 'health' ? '体检' : '抓取'}进行中（{status.round.kind}）
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
          <CardDescription>按下次检查时间排序；单源可手动抓取。</CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有配置 feed 的友链——在「友链」页为朋友填写 feed 地址后即可参与朋友圈。
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
                          <Button variant="ghost" size="icon" className="size-8" disabled={singleBusy !== null} onClick={() => void crawlOne(f.id)} aria-label="抓取此源">
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
          <CardDescription>库内按发布时间倒序的最新文章；过旧文章由每日清理任务自动删除。</CardDescription>
        </CardHeader>
        <CardContent>
          {articles.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有文章——抓取成功后这里会显示朋友们的最近动态。</p>
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
                      <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => void deleteArticle(a.id)} aria-label="删除文章">
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
