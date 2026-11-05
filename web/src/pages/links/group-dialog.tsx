import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { groupCreateSchema, type Group } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { invalidateLinkData } from '@/lib/query'
import { Field } from './field'

const groupFormSchema = groupCreateSchema.pick({ name: true, desc: true })
type GroupFormValues = z.infer<typeof groupFormSchema>

export function GroupDialog(props: {
  editing: Group | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { editing, open, onOpenChange } = props
  const client = useQueryClient()
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: '', desc: '' },
  })

  useEffect(() => {
    if (open) form.reset({ name: editing?.name ?? '', desc: editing?.desc ?? '' })
  }, [open, editing, form])

  const mutation = useMutation({
    mutationFn: (values: GroupFormValues) => {
      const body = JSON.stringify({ name: values.name, desc: values.desc || null })
      return editing
        ? api(`/api/admin/groups/${editing.id}`, { method: 'PATCH', body })
        : api('/api/admin/groups', { method: 'POST', body })
    },
    onSuccess: () => {
      toast.success(editing ? '分组已更新' : '分组已创建')
      invalidateLinkData(client)
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '保存失败'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑分组' : '新建分组'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-3">
          <Field label="名称 *" error={form.formState.errors.name?.message}>
            <Input {...form.register('name')} maxLength={100} placeholder="如：朋友们" />
          </Field>
          <Field label="说明" error={form.formState.errors.desc?.message}>
            <Input {...form.register('desc')} maxLength={2000} placeholder="展示在分组标题下（可选）" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={mutation.isPending}>保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
