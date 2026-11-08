import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Hammer, Newspaper, Play, RefreshCw, Rss, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { DataTable } from '@/components/common/data-table'
import { EmptyState, ErrorState } from '@/components/common/page-state'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { SegmentedControl } from '@/components/common/segmented-control'
import { StatusBadge } from '@/components/common/status-badge'
import { api, type ArticleRow } from '@/lib/api'
import { useArticlesQuery, useHealthQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { jobProgress, useJobStatus } from '@/lib/jobs'
import { formatDateTime, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'
import { useQueryParam } from '@/lib/url-state'

const OUTCOME: Record<string, string> = {
  ok: '成功',
  notModified: '无更新（304）',
  failed: '失败',
  skipped: '跳过',
}

export default function CirclePage() {
  const settings = useSettings()
  const client = useQueryClient()
  const healthQuery = useHealthQuery()
  const articlesQuery = useArticlesQuery()
  const jobQuery = useJobStatus()
  const [filter, setFilter] = useQueryParam('filter', 'all')
  const [pageParam, setPageParam] = useQueryParam('page', '1')
  const [deleteArticle, setDeleteArticle] = useState<ArticleRow | null>(null)

  const pageSize = Math.max(1, typeof settings['ui.pageSize'] === 'number' ? (settings['ui.pageSize'] as number) : 20)
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const fmt = (iso: string | null | undefined) => formatDateTime(iso, settingsDateTimeOptions(settings))
  const rebuildEnabled = settings['rebuild.enabled'] === true

  const crawl = useMutation({
    mutationFn: () => api<{ started: number }>('/api/admin/crawl', { method: 'POST' }),
    onSuccess: (result) => {
      toast.success(result.started > 0 ? `已开始抓取 ${result.started} 个源` : '没有待抓取的友链')
      void client.invalidateQueries({ queryKey: queryKeys.crawlStatus })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '触发失败'),
  })

  const rebuild = useMutation({
    mutationFn: () =>
      api<{ provider: string }>('/api/admin/rebuild', {
        method: 'POST',
        body: JSON.stringify({ reason: 'manual' }),
      }),
    onSuccess: (result) => toast.success(`已触发重建（${result.provider}）`),
    onError: (error) => toast.error(error instanceof Error ? error.message : '触发失败'),
  })

  const crawlOne = useMutation({
    mutationFn: (id: number) => api<{ outcome: string }>(`/api/admin/crawl/${id}`, { method: 'POST' }),
    onSuccess: (result) => {
      toast.info(`抓取结果：${OUTCOME[result.outcome] ?? result.outcome}`)
      void client.invalidateQueries({ queryKey: queryKeys.health })
      void client.invalidateQueries({ queryKey: queryKeys.articles })
      void client.invalidateQueries({ queryKey: queryKeys.stats })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '抓取失败'),
  })

  const removeArticle = useMutation({
    mutationFn: (id: number) => api(`/api/admin/articles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleteArticle(null)
      toast.success('文章已删除')
      void client.invalidateQueries({ queryKey: queryKeys.articles })
      void client.invalidateQueries({ queryKey: queryKeys.stats })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '删除失败'),
  })

  const firstError = healthQuery.error ?? articlesQuery.error
  if (firstError && !healthQuery.data) {
    return (
      <div className="grid min-w-0 gap-5">
        <PageHeader title="朋友圈" description="抓取状态与最近文章。" />
        <ErrorState
          title="朋友圈数据加载失败"
          error={firstError}
          onRetry={() => {
            void healthQuery.refetch()
            void articlesQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (healthQuery.isPending || articlesQuery.isPending) {
    return (
      <div className="grid gap-5">
        <PageHeader title="朋友圈" description="抓取状态与最近文章。" />
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    )
  }

  const friends = healthQuery.data?.friends ?? []
  const sources = friends.filter((friend) => friend.status === 'active' && friend.inCircle && friend.feed)
  const failed = sources.filter((source) => source.state?.reachable === false || source.state?.crawlable === false)
  const filtered = filter === 'failed' ? failed : sources

  const allArticles = articlesQuery.data?.articles ?? []
  const pages = Math.max(1, Math.ceil(allArticles.length / pageSize))
  const current = Math.min(page, pages)
  const articles = allArticles.slice((current - 1) * pageSize, current * pageSize)
  const job = jobQuery.data
  const round = job?.round
  const running = Boolean(job?.running)
  const percent = round ? jobProgress(round.done, round.total) : 0

  return (
    <TooltipProvider>
      <div className="grid gap-5">
        <PageHeader
          eyebrow={`${sources.length} 个抓取源 · ${failed.length} 个异常`}
          title="朋友圈"
          description="分批轮转抓取；抓取状态与文章会随任务完成自动刷新。"
          actions={
            <>
              {rebuildEnabled && (
                <Button variant="outline" onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
                  <Hammer /> {rebuild.isPending ? '触发中…' : '重建站点'}
                </Button>
              )}
              <Button onClick={() => crawl.mutate()} disabled={crawl.isPending || running}>
                <Play /> {running ? '抓取进行中…' : crawl.isPending ? '启动中…' : '手动抓取一轮'}
              </Button>
            </>
          }
        />

        {running && round && (
          <Card className="py-0">
            <div className="grid gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  {round.kind === 'health' ? '体检进行中' : '抓取进行中'} · 任务完成后自动刷新
                </span>
                <span className="font-mono tabular-nums text-subtle">{round.done}/{round.total} · {percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="抓取进度">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
            </div>
          </Card>
        )}

        <Card className="gap-0 py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 text-base"><Rss className="size-4 text-primary" /> 抓取状态</h2>
              <p className="mt-1 text-[11px] text-subtle">按下次检查时间排序，失败源会按退避阶梯拉长间隔。</p>
            </div>
            <SegmentedControl
              ariaLabel="筛选抓取源"
              value={filter === 'failed' ? 'failed' : 'all'}
              onChange={setFilter}
              items={[
                { value: 'all', label: '全部', count: sources.length },
                { value: 'failed', label: '异常', count: failed.length },
              ]}
            />
          </div>
          {filtered.length === 0 ? (
            <EmptyState
              compact
              icon={Rss}
              title={sources.length === 0 ? '还没有可抓取的源' : '没有异常源'}
              description={sources.length === 0 ? '在「友链」页给友链补上 RSS 地址即可。' : '所有源最近一次检查都正常。'}
            />
          ) : (
            <DataTable
              rows={[...filtered].sort((a, b) => (a.state?.nextCheckAt ?? '').localeCompare(b.state?.nextCheckAt ?? ''))}
              getRowKey={(source) => source.id}
              columns={[
                {
                  key: 'source',
                  header: '源',
                  cell: (source) => (
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{source.author}</p>
                      <a href={source.link} target="_blank" rel="noreferrer" className="block truncate font-mono text-[10px] text-subtle hover:text-primary hover:underline">
                        {source.link}
                      </a>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: '状态',
                  cell: (source) => (
                    <div className="flex flex-wrap items-center gap-1">
                      {source.state?.reachable === false || source.state?.crawlable === false ? (
                        <StatusBadge tone="danger">失败</StatusBadge>
                      ) : (
                        <StatusBadge tone="success">正常</StatusBadge>
                      )}
                      {source.state?.crawlable === false && <StatusBadge tone="warning">RSS 不可用</StatusBadge>}
                      {(source.state?.failCount ?? 0) > 0 && <StatusBadge tone="neutral">连败 {source.state?.failCount}</StatusBadge>}
                      {source.state?.lastError && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="text-[10px] text-subtle underline underline-offset-2 hover:text-foreground">
                              错误详情
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72 text-xs">{source.state.lastError}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  ),
                },
                { key: 'lastPost', header: '最近发文', cell: (source) => fmt(source.state?.lastPostPublished), hideOnMobile: true },
                { key: 'lastOk', header: '最近成功', cell: (source) => fmt(source.state?.lastOkAt), hideOnMobile: true },
                { key: 'nextCheck', header: '下次检查', cell: (source) => fmt(source.state?.nextCheckAt), hideOnMobile: true },
              ]}
              actions={(source) => (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => crawlOne.mutate(source.id)}
                  disabled={crawlOne.isPending}
                  aria-label={`抓取 ${source.author}`}
                >
                  <RefreshCw className={crawlOne.isPending && crawlOne.variables === source.id ? 'animate-spin' : undefined} />
                </Button>
              )}
            />
          )}
        </Card>

        <Card className="gap-0 py-0">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 text-base"><Newspaper className="size-4 text-primary" /> 最近文章</h2>
              <p className="mt-1 text-[11px] text-subtle">按发布时间倒序；超出保留期的文章会自动清理。</p>
            </div>
            <StatusBadge tone="neutral">{allArticles.length} 篇</StatusBadge>
          </div>
          {allArticles.length === 0 ? (
            <EmptyState compact icon={Newspaper} title="还没有抓到文章" description="抓取成功后，文章会出现在这里。" />
          ) : (
            <div className="grid gap-3 p-3 sm:p-4">
              <DataTable
                rows={articles}
                getRowKey={(article) => article.id}
                columns={[
                  {
                    key: 'title',
                    header: '标题',
                    cell: (article) => (
                      <a href={article.link} target="_blank" rel="noreferrer" className="block max-w-96 truncate text-sm text-foreground hover:underline">
                        {article.title}
                      </a>
                    ),
                  },
                  { key: 'author', header: '来源', cell: (article) => article.friendAuthor, hideOnMobile: true },
                  { key: 'published', header: '发布时间', cell: (article) => fmt(article.publishedAt), hideOnMobile: true },
                ]}
                actions={(article) => (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-danger hover:text-danger"
                    onClick={() => setDeleteArticle(article)}
                    aria-label={`删除文章 ${article.title}`}
                  >
                    <Trash2 />
                  </Button>
                )}
              />
              <Pagination page={current} pageSize={pageSize} total={allArticles.length} onPageChange={(next) => setPageParam(String(next))} />
            </div>
          )}
        </Card>

        <ConfirmDialog
          open={deleteArticle !== null}
          onOpenChange={(open) => !open && setDeleteArticle(null)}
          title="删除文章？"
          description={deleteArticle ? `将删除「${deleteArticle.title}」，下次抓取时可能重新出现。` : null}
          confirmLabel="删除"
          tone="danger"
          pending={removeArticle.isPending}
          onConfirm={() => deleteArticle && removeArticle.mutate(deleteArticle.id)}
        />
      </div>
    </TooltipProvider>
  )
}
