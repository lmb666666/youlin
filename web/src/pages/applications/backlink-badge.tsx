import { Badge } from '@/components/ui/badge'
import { ShieldCheck, ShieldQuestion } from 'lucide-react'
import type { Application } from '@/lib/api'

export function BacklinkBadge({ app }: { app: Application }) {
  const b = app.backlink
  if (b.ok === true) {
    return (
      <span title={b.detail ?? ''}>
        <Badge variant="secondary">
          <ShieldCheck /> 有反链
        </Badge>
      </span>
    )
  }
  if (b.ok === false) {
    return (
      <span title={b.detail ?? ''}>
        <Badge variant="destructive">
          <ShieldQuestion /> 无反链
        </Badge>
      </span>
    )
  }
  return (
    <span title={b.detail ?? '未检测'}>
      <Badge variant="outline">未检测</Badge>
    </span>
  )
}
