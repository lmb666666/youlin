import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Inbox, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Avatar } from '@/components/common/avatar'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState } from '@/components/common/page-state'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { SearchField } from '@/components/common/search-field'
import { SegmentedControl } from '@/components/common/segmented-control'
import { StatusBadge } from '@/components/common/status-badge'
import { api, type Application } from '@/lib/api'
import { useApplicationsQuery, useGroupsQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { formatDateTime, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'
import { useQueryParam } from '@/lib/url-state'
import { BacklinkBadge } from './backlink-badge'
import { ApproveDialog } from './approve-dialog'
import { RejectDialog } from './reject-dialog'

const STATUS = ['pending', 'approved', 'rejected', 'all'] as const
type Status = (typeof STATUS)[number]

function statusOf(value: string): Status {
  return STATUS.includes(value as Status) ? (value as Status) : 'pending'
}

function statusBadge(status: Application['status']) {
  if (status === 'approved') return <StatusBadge tone="success">已通过</StatusBadge>
  if (status === 'rejected') return <StatusBadge tone="danger">已拒绝</StatusBadge>
  return <StatusBadge tone="warning">待审核</StatusBadge>
}

export default function ApplicationsPage() {
  const settings = useSettings()
  const client = useQueryClient()
  const appsQuery = useApplicationsQuery('all')
  const groupsQuery = useGroupsQuery()
  const [statusParam, setStatusParam] = useQueryParam('status', 'pending')
  const [q, setQ] = useQueryParam('q')
  const [pageParam, setPageParam] = useQueryParam('page', '1')
  const [approveTarget, setApproveTarget] = useState<Application | null>(null)
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null)
  const [clearOpen, setClearOpen] = useState(false)

  const pageSize = Math.max(1, typeof settings['ui.pageSize'] === 'number' ? (settings['ui.pageSize'] as number) : 20)
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const tab = statusOf(statusParam)
  const fmt = (iso: string | null | undefined) => formatDateTime(iso, settingsDateTimeOptions(settings))
  const groups = useMemo(() => groupsQuery.data?.groups ?? [], [groupsQuery.data])
  const rebuildEnabled = settings['rebuild.enabled'] === true

  const clearReviewed = useMutation({
    mutationFn: () => api<{ deleted: number }>('/api/admin/applications/reviewed', { method: 'DELETE' }),
    onSuccess: async (result) => {
      setClearOpen(false)
      toast.success(`已清理 ${result.deleted} 条已处理申请`)
      await client.invalidateQueries({ queryKey: queryKeys.applications('all') })
      await client.invalidateQueries({ queryKey: queryKeys.stats })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '清理失败'),
  })

  if (appsQuery.isError) {
    return (
      <div className="grid min-w-0 gap-5">
        <PageHeader title="申请" description="通过后自动入库，接口立即生效。" />
        <ErrorState title="申请加载失败" error={appsQuery.error} onRetry={() => void appsQuery.refetch()} />
      </div>
    )
  }

  if (appsQuery.isPending) {
    return (
      <div className="grid gap-5">
        <PageHeader title="申请" description="通过后自动入库，接口立即生效。" />
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    )
  }

  const apps = appsQuery.data?.applications ?? []
  const counts = {
    pending: apps.filter((app) => app.status === 'pending').length,
    approved: apps.filter((app) => app.status === 'approved').length,
    rejected: apps.filter((app) => app.status === 'rejected').length,
    all: apps.length,
  }
  const normalized = q.trim().toLowerCase()
  const filtered = apps.filter((app) => {
    if (tab !== 'all' && app.status !== tab) return false
    if (!normalized) return true
    return [app.siteName, app.author, app.link, app.contact].some((value) => value?.toLowerCase().includes(normalized))
  })
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const rows = filtered.slice((current - 1) * pageSize, current * pageSize)
  const reviewed = counts.approved + counts.rejected

  return (
    <TooltipProvider>
      <div className="grid gap-5">
        <PageHeader
          eyebrow={`${counts.pending} 条待审核 · 共 ${counts.all} 条`}
          title="申请"
          description="通过后自动入库，公开接口立即生效。"
          actions={
            <Button variant="outline" onClick={() => setClearOpen(true)} disabled={reviewed === 0 || clearReviewed.isPending}>
              清理已处理
            </Button>
          }
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchField
            value={q}
            onChange={setQ}
            placeholder="搜索站点 / 作者 / 链接"
            ariaLabel="搜索申请"
            className="w-full sm:max-w-xs"
          />
          <SegmentedControl
            ariaLabel="按状态筛选申请"
            value={tab}
            onChange={setStatusParam}
            items={[
              { value: 'pending', label: '待审核', count: counts.pending },
              { value: 'approved', label: '已通过', count: counts.approved },
              { value: 'rejected', label: '已拒绝', count: counts.rejected },
              { value: 'all', label: '全部', count: counts.all },
            ]}
          />
        </div>

        {filtered.length === 0 ? (
          <Card className="py-0">
            <EmptyState
              icon={Inbox}
              title={normalized ? '没有匹配的申请' : tab === 'pending' ? '没有待审核的申请' : '没有相关申请'}
              description={normalized ? '换一个关键词试试。' : tab === 'pending' ? '新的申请会先进入这里。' : undefined}
            />
          </Card>
        ) : (
          <div className="grid gap-3">
            {rows.map((app) => (
              <Card key={app.id} className="gap-0 py-0">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar name={app.author ?? app.siteName} src={app.avatar} size="md" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h2 className="truncate text-sm font-medium">{app.siteName}</h2>
                        {statusBadge(app.status)}
                        <BacklinkBadge app={app} />
                      </div>
                      <a
                        href={app.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex max-w-full items-center gap-1 truncate font-mono text-[10.5px] text-subtle hover:text-primary hover:underline"
                      >
                        <span className="truncate">{app.link}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </div>
                  </div>
                  {app.status === 'pending' && (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => setApproveTarget(app)}>
                        <Check /> 通过
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejectTarget(app)}>
                        <X /> 拒绝
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid gap-1.5 px-4 py-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {app.author && <span>站长：{app.author}</span>}
                    {app.contact && <span>联系：{app.contact}</span>}
                    {app.feed && <span className="max-w-full truncate">RSS：{app.feed}</span>}
                    <span>提交于 {fmt(app.createdAt)}</span>
                    {app.reviewedAt && <span>审核于 {fmt(app.reviewedAt)}</span>}
                  </div>
                  {app.desc && <p className="text-[11px] leading-relaxed">{app.desc}</p>}
                  {app.note && <p className="text-[11px] leading-relaxed">备注：{app.note}</p>}
                  {app.backlink.detail && <p className="text-[11px] leading-relaxed text-subtle">反链证据：{app.backlink.detail}</p>}
                  {app.reviewNote && <p className="text-[11px] leading-relaxed text-subtle">审核记录：{app.reviewNote}</p>}
                </div>
              </Card>
            ))}
            <Pagination page={current} pageSize={pageSize} total={filtered.length} onPageChange={(next) => setPageParam(String(next))} />
          </div>
        )}

        <ApproveDialog
          app={approveTarget}
          groups={groups}
          rebuildEnabled={rebuildEnabled}
          onOpenChange={(open) => !open && setApproveTarget(null)}
        />
        <RejectDialog app={rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)} />
        <ConfirmDialog
          open={clearOpen}
          onOpenChange={setClearOpen}
          title="清理已处理申请？"
          description={`将删除 ${reviewed} 条已通过/已拒绝的申请记录，不影响友链数据，此操作不可撤销。`}
          confirmLabel="确认清理"
          tone="danger"
          pending={clearReviewed.isPending}
          onConfirm={() => clearReviewed.mutate()}
        />
      </div>
    </TooltipProvider>
  )
}
