import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { applicationRejectSchema, type ApplicationRejectInput } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/common/form-field'
import { api, type Application } from '@/lib/api'
import { queryKeys } from '@/lib/query'

export function RejectDialog({
  app,
  onOpenChange,
}: {
  app: Application | null
  onOpenChange: (open: boolean) => void
}) {
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
    onSuccess: async () => {
      toast.success('已拒绝该申请')
      await client.invalidateQueries({ queryKey: queryKeys.applications('all') })
      await client.invalidateQueries({ queryKey: queryKeys.stats })
      onOpenChange(false)
    },
    onError: (error) => form.setError('root', { message: error instanceof Error ? error.message : '操作失败' }),
  })

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>拒绝申请：{app?.siteName}</DialogTitle>
          <DialogDescription>原因仅自己可见，会记录在审核历史里。</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="grid gap-4">
          <FormField id="reject-reason" label="拒绝原因" hint="可选，写一句方便以后回顾">
            <Textarea id="reject-reason" {...form.register('reason')} rows={3} maxLength={2000} placeholder="如：缺少反链 / 内容不符合" />
          </FormField>
          {form.formState.errors.root?.message && (
            <p role="alert" className="text-xs text-danger">{form.formState.errors.root.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>取消</Button>
            <Button type="submit" variant="destructive" disabled={mutation.isPending}>
              {mutation.isPending ? '处理中…' : '确认拒绝'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
