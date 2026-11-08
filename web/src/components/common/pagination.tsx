import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  const current = Math.min(Math.max(1, page), pages)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-1 pt-3 text-xs text-muted-foreground">
      <span>
        第 {current} / {pages} 页 · 共 {total} 条
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          aria-label="上一页"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
          aria-label="下一页"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
