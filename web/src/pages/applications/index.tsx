import { useMemo, useState } from 'react'
import { Check, ExternalLink, Inbox, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Application } from '@/lib/api'
import { useApplicationsQuery, useGroupsQuery } from '@/lib/queries'
import { useQueryErrorToast } from '@/lib/query-error'
import { formatDateTime, settingsDateTimeOptions } from '@/lib/format'
import { useSettings } from '@/lib/settings'
import { BacklinkBadge } from './backlink-badge'
import { ApproveDialog } from './approve-dialog'
import { RejectDialog } from './reject-dialog'

const TABS = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'all', label: '全部' },
] as const

export default function ApplicationsPage() {
  const settings = useSettings()
  const fmt = (iso: string | null | undefined) => formatDateTime(iso, settingsDateTimeOptions(settings))
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('pending')
  const [approveTarget, setApproveTarget] = useState<Application | null>(null)
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null)

  const appsQuery = useApplicationsQuery(tab)
  const groupsQuery = useGroupsQuery()
  useQueryErrorToast(appsQuery.error ?? groupsQuery.error)
  const groups = useMemo(() => groupsQuery.data?.groups ?? [], [groupsQuery.data])

  if (appsQuery.isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const apps = appsQuery.data?.applications ?? []
  const rebuildEnabled = settings['rebuild.enabled'] === true

  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">申请</h1>
          <p className="text-sm text-muted-foreground">
            通过后自动入库，接口立即生效。
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg border p-0.5">
          {TABS.map((t) => (
            <Button
              key={t.value}
              variant={tab === t.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <Inbox className="size-8" />
            <p>{tab === 'pending' ? '没有待审核的申请' : '没有相关申请'}</p>
          </CardContent>
        </Card>
      ) : (
        apps.map((a) => (
          <Card key={a.id}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="min-w-0">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="truncate">{a.siteName}</span>
                  {a.status === 'pending' && <Badge>待审核</Badge>}
                  {a.status === 'approved' && <Badge variant="secondary">已通过</Badge>}
                  {a.status === 'rejected' && <Badge variant="destructive">已拒绝</Badge>}
                  <BacklinkBadge app={a} />
                </CardTitle>
                <CardDescription className="mt-1">
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    {a.link} <ExternalLink className="size-3" />
                  </a>
                </CardDescription>
              </div>
              {a.status === 'pending' && (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => setApproveTarget(a)}>
                    <Check /> 通过
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectTarget(a)}>
                    <X /> 拒绝
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="grid gap-1 text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {a.author && <span>站长：{a.author}</span>}
                {a.contact && <span>联系：{a.contact}</span>}
                {a.feed && <span className="truncate">feed：{a.feed}</span>}
                <span>提交于 {fmt(a.createdAt)}</span>
              </div>
              {a.desc && <p>{a.desc}</p>}
              {a.note && <p>备注：{a.note}</p>}
              {a.backlink.detail && <p className="text-xs">反链证据：{a.backlink.detail}</p>}
              {a.reviewNote && <p className="text-xs">审核记录：{a.reviewNote}</p>}
            </CardContent>
          </Card>
        ))
      )}

      <ApproveDialog
        app={approveTarget}
        groups={groups}
        rebuildEnabled={rebuildEnabled}
        onOpenChange={(open) => !open && setApproveTarget(null)}
      />
      <RejectDialog app={rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)} />
    </div>
  )
}
