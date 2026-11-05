import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { applicationRejectSchema, type ApplicationRejectInput } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, type Application } from '@/lib/api'

export function RejectDialog(props: {
  app: Application | null
  onOpenChange: (open: boolean) => void
}) {
  const { app, onOpenChange } = props
  const client = useQueryClient()
  const form = useForm<ApplicationRejectInput>({
    resolver: zodResolver(applicationRejectSchema),
    defaultValues: { reason: '' },
  })

  useEffect(() => {
    if (app) form.reset({ reason: '' })
  }, [app, form])

  const mutation = useMutation({
    mutationFn: (values: ApplicationRejectInput) =>
      api(`/api/admin/applications/${app!.id}/reject`, {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success('已拒绝该申请')
      void client.invalidateQueries({ queryKey: ['applications'] })
      void client.invalidateQueries({ queryKey: ['stats'] })
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '操作失败'),
  })

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>拒绝申请：{app?.siteName}</DialogTitle>
          <DialogDescription>原因仅自己可见。</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="grid gap-3">
          <Textarea {...form.register('reason')} rows={3} maxLength={2000} placeholder="如：缺少反链 / 内容不符合" />
          {form.formState.errors.reason && <p className="text-xs text-destructive">{form.formState.errors.reason.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" variant="destructive" disabled={mutation.isPending}>确认拒绝</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
