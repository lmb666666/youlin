import { ShieldCheck, ShieldQuestion } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/common/status-badge'
import type { Application } from '@/lib/api'

export function BacklinkBadge({ app }: { app: Application }) {
  const detail = app.backlink.detail ?? '尚未检测'
  if (app.backlink.ok === true) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span><StatusBadge tone="success" icon={ShieldCheck}>有反链</StatusBadge></span>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-xs">{detail}</TooltipContent>
      </Tooltip>
    )
  }
  if (app.backlink.ok === false) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span><StatusBadge tone="danger" icon={ShieldQuestion}>无反链</StatusBadge></span>
        </TooltipTrigger>
        <TooltipContent className="max-w-72 text-xs">{detail}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span><StatusBadge tone="neutral">未检测</StatusBadge></span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs">{detail}</TooltipContent>
    </Tooltip>
  )
}
