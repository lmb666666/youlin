import { Link } from 'react-router'
import {
  ArrowRight,
  FileText,
  HeartPulse,
  Link2,
  Newspaper,
  RefreshCw,
  Rss,
  UserRoundPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar } from '@/components/common/avatar'
import { EmptyState, ErrorState } from '@/components/common/page-state'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { StatusBadge } from '@/components/common/status-badge'
import { useAdminStatsQuery, useApplicationsQuery, useArticlesQuery } from '@/lib/queries'
import { useApiMutation } from '@/lib/mutations'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query'
import { jobProgress, useJobStatus } from '@/lib/jobs'
import { formatDateTime, formatRelative, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'

function PanelHead({ title, sub, to, action }: { title: string; sub: string; to?: string; action?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
      <div>
        <h2 className="text-base">{title}</h2>
        <p className="mt-1 text-xs text-subtle">{sub}</p>
      </div>
      {to && (
        <Button variant="ghost" size="sm" asChild>
          <Link to={to}>
            {action ?? '全部'} <ArrowRight />
          </Link>
        </Button>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const settings = useSettings()
  const fmtRelative = (value: string | null | undefined) => formatRelative(value, typeof settings['site.locale'] === 'string' ? settings['site.locale'] : 'zh-CN')
  const fmtDateTime = (value: string | null | undefined) => formatDateTime(value, settingsDateTimeOptions(settings))

  const statsQuery = useAdminStatsQuery()
  const articlesQuery = useArticlesQuery()
  const pendingQuery = useApplicationsQuery('pending')
  const jobQuery = useJobStatus()

  const crawl = useApiMutation<{ started: number }, void>({
    mutationFn: () => api('/api/admin/crawl', { method: 'POST' }),
    invalidate: [queryKeys.crawlStatus],
    successMessage: '已开始抓取一轮',
  })

  const firstError = statsQuery.error ?? articlesQuery.error ?? pendingQuery.error
  if (firstError && !statsQuery.data) {
    return (
      <div className="grid min-w-0 gap-5">
        <PageHeader title="总览" description="站点数据、待办与抓取状态一览。" />
        <ErrorState
          title="总览数据加载失败"
          error={firstError}
          onRetry={() => {
            void statsQuery.refetch()
            void articlesQuery.refetch()
            void pendingQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (statsQuery.isPending || !statsQuery.data) {
    return (
      <div className="grid gap-5">
        <PageHeader title="总览" description="站点数据、待办与抓取状态一览。" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    )
  }

  const stats = statsQuery.data
  const articles = (articlesQuery.data?.articles ?? []).slice(0, 5)
  const pending = (pendingQuery.data?.applications ?? []).slice(0, 4)
  const job = jobQuery.data
  const running = Boolean(job?.running)
  const round = job?.round
  const percent = round ? jobProgress(round.done, round.total) : 0

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date())}
        title="总览"
        description="站点数据、待办与抓取状态一览。"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/admin/links?import=1">
                <Rss /> 导入数据
              </Link>
            </Button>
            <Button asChild>
              <Link to="/admin/links">
                <Link2 /> 管理友链 <ArrowRight />
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Link2}
          label="友链"
          value={stats.friends.active}
          sub={stats.friends.hidden > 0 ? `${stats.friends.hidden} 个隐藏` : '全部显示'}
        />
        <StatCard
          icon={Rss}
          label="朋友圈源"
          value={stats.circle.sources}
          sub={`${stats.circle.due} 个待检查`}
        />
        <StatCard
          icon={HeartPulse}
          label="失联站点"
          value={stats.friends.unreachable}
          sub={stats.friends.unreachable > 0 ? '需要关注' : '一切正常'}
          tone={stats.friends.unreachable > 0 ? 'warning' : 'default'}
        />
        <StatCard
          icon={UserRoundPlus}
          label="待审申请"
          value={stats.applications.pending}
          sub={stats.applications.pending > 0 ? '等待处理' : '暂无'}
          tone={stats.applications.pending > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card className="gap-0 py-0">
          <PanelHead title="最近文章" sub={`共 ${stats.articles.total} 篇 · 按发布时间倒序`} to="/admin/circle" />
          <CardContent className="px-0 pb-2">
            {articlesQuery.isError ? (
              <div className="grid place-items-center gap-2 px-5 py-8 text-center text-xs text-danger">
                <p>{articlesQuery.error instanceof Error ? articlesQuery.error.message : '文章加载失败'}</p>
                <Button variant="ghost" size="sm" onClick={() => void articlesQuery.refetch()}>重试</Button>
              </div>
            ) : articles.length === 0 ? (
              <EmptyState
                compact
                icon={Newspaper}
                title="还没有抓到文章"
                description="给友链填写 RSS 后，文章会自动出现在这里。"
                action={<Button variant="outline" size="sm" asChild><Link to="/admin/links">去添加订阅</Link></Button>}
              />
            ) : (
              <ul className="divide-y">
                {articles.map((article) => (
                  <li key={article.id}>
                    <a
                      href={article.link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/60"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-secondary text-subtle">
                        <FileText className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{article.title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-subtle">
                          {article.friendAuthor} · {fmtRelative(article.publishedAt)}
                        </span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <PanelHead title="待审申请" sub={`${stats.applications.pending} 条待处理`} to="/admin/applications" action="查看全部" />
          <CardContent className="px-0 pb-2">
            {pendingQuery.isError ? (
              <div className="grid place-items-center gap-2 px-5 py-8 text-center text-xs text-danger">
                <p>{pendingQuery.error instanceof Error ? pendingQuery.error.message : '申请加载失败'}</p>
                <Button variant="ghost" size="sm" onClick={() => void pendingQuery.refetch()}>重试</Button>
              </div>
            ) : pending.length === 0 ? (
              <EmptyState
                compact
                icon={UserRoundPlus}
                title="没有待审申请"
                description="新的友链申请会先进入这里。"
              />
            ) : (
              <ul className="divide-y">
                {pending.map((application) => (
                  <li key={application.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={application.author ?? application.siteName} src={application.avatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{application.siteName}</p>
                      <p className="mt-0.5 truncate text-[11px] text-subtle">
                        {fmtRelative(application.createdAt)}
                        {application.backlink.ok === false ? ' · 未检测到反链' : application.backlink.ok ? ' · 已检测到反链' : ' · 反链未检测'}
                      </p>
                    </div>
                    {application.backlink.ok === false ? (
                      <StatusBadge tone="warning">待审</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">待审</StatusBadge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <CardContent className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="grid size-8 place-items-center rounded-lg border bg-secondary text-subtle">
            <RefreshCw className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {running && round ? `${round.kind === 'health' ? '体检' : '抓取'}进行中 · ${round.done}/${round.total}` : '抓取轮转'}
            </p>
            <p className="mt-0.5 text-[11px] text-subtle">
              {running
                ? `已完成 ${percent}% · 完成后会自动刷新`
                : `${job?.dueCount ?? stats.circle.due} / ${job?.activeCount ?? stats.circle.sources} 个源待检查 · 最近入库 ${fmtDateTime(stats.articles.lastArticleAt)}`}
            </p>
            {running && (
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="抓取进度"
              >
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => crawl.mutate()} disabled={running || crawl.isPending}>
            <RefreshCw className={crawl.isPending ? 'animate-spin' : undefined} />
            {crawl.isPending ? '启动中…' : '抓取一轮'}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/circle">朋友圈 <ArrowRight /></Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
