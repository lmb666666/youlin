import { Button } from '@/components/ui/button'

export function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid justify-items-start gap-2 rounded-lg border p-4 text-sm">
      <p className="text-destructive">加载失败：{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>重试</Button>
    </div>
  )
}
