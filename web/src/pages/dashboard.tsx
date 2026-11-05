import { Link, useNavigate } from 'react-router'
import {
  ArrowRight, FileText, HeartPulse, Inbox, Link2, Newspaper,
  Rss, ShieldQuestion, TriangleAlert, UserRoundPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminStatsQuery, useApplicationsQuery, useArticlesQuery, useCrawlStatusQuery } from '@/lib/queries'
import { useQueryErrorToast } from '@/lib/query-error'
import { formatDateTime, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'

function StatCard(props: {
  to: string
  icon: React.ElementType
  label: string
  value: number | string
  sub?: string
  tone?: 'default' | 'warn'
}) {
  const { to, icon: Icon, label, value, sub, tone = 'default' } = props
  return (
    <Link to={to} className="group">
      <Card className={`transition-colors group-hover:border-foreground/25 ${tone === 'warn' && (typeof value === 'number' ? value > 0 : false) ? 'border-amber-500/50' : ''}`}>
        <CardContent className="flex items-center gap-3 py-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-semibold leading-tight tabular-nums">{value}</div>
            <div className="truncate text-xs text-muted-foreground">
              {label}
              {sub && <span className="text-muted-foreground/70"> · {sub}</span>}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const settings = useSettings()
  const fmt = (iso: string | null | undefined) => formatDateTime(iso, settingsDateTimeOptions(settings))
  const statsQuery = useAdminStatsQuery()
  const statusQuery = useCrawlStatusQuery()
  const articlesQuery = useArticlesQuery()
  const pendingQuery = useApplicationsQuery('pending')

  useQueryErrorToast(statsQuery.error ?? statusQuery.error ?? articlesQuery.error ?? pendingQuery.error)

  if (statsQuery.isPending || statusQuery.isPending || articlesQuery.isPending || pendingQuery.isPending) {
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  const stats = statsQuery.data
  const status = statusQuery.data
  const articles = (articlesQuery.data?.articles ?? []).slice(0, 6)
  const pending = (pendingQuery.data?.applications ?? []).slice(0, 4)
  if (!stats || !status) {
    return <p className="text-sm text-muted-foreground">数据加载失败，请刷新重试。</p>
  }

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div>
        <h1 className="text-lg font-semibold">总览</h1>
        <p className="text-sm text-muted-foreground">站点数据与待办一览。</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard to="/admin/links" icon={Link2} label="友链" value={stats.friends.active}
          sub={stats.friends.hidden > 0 ? `${stats.friends.hidden} 个隐藏` : undefined} />
        <StatCard to="/admin/circle" icon={Rss} label="朋友圈源" value={stats.circle.sources}
          sub={`${stats.circle.due} 个待检查`} />
        <StatCard to="/admin/health" icon={HeartPulse} label="失联站点" value={stats.friends.unreachable}
          sub={stats.friends.unreachable > 0 ? '需要关注' : '一切正常'} tone="warn" />
        <StatCard to="/admin/applications" icon={UserRoundPlus} label="待审申请" value={stats.applications.pending}
          sub={stats.applications.pending > 0 ? '等待处理' : '暂无'} tone="warn" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Newspaper className="size-4" /> 最近文章
              </CardTitle>
              <CardDescription>共 {stats.articles.total} 篇</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/circle">全部 <ArrowRight /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {articles.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">还没有抓到文章</p>
            ) : (
              <ul className="grid gap-1">
                {articles.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <a href={a.link} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                      {a.title}
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">{a.friendAuthor}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldQuestion className="size-4" /> 待审申请
              </CardTitle>
              <CardDescription>{stats.applications.pending} 条待处理</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin/applications">全部 <ArrowRight /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">没有待审申请</p>
            ) : (
              <ul className="grid gap-1">
                {pending.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                    <span className="min-w-0 flex-1 truncate">{p.siteName}</span>
                    {p.backlink.ok === false && <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />}
                    <span className="shrink-0 text-xs text-muted-foreground">{fmt(p.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Inbox className="size-4" />
            抓取轮转：{status.running ? `进行中 ${status.round?.done ?? 0}/${status.round?.total ?? 0}` : `${status.dueCount}/${status.activeCount} 个源待检查`}
            {stats.articles.lastArticleAt && <span className="hidden sm:inline">· 最近入库 {fmt(stats.articles.lastArticleAt)}</span>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate('/admin/import')}>
              <Inbox /> 导入数据
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/admin/api')}>
              接入说明
            </Button>
            <Button size="sm" onClick={() => navigate('/admin/links')}>
              管理友链 <ArrowRight />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
