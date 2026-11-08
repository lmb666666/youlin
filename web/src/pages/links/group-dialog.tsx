import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { groupCreateSchema, type Group } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FormField, fieldAria } from '@/components/common/form-field'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query'

const groupFormSchema = groupCreateSchema.pick({ name: true, desc: true })
type GroupFormValues = z.infer<typeof groupFormSchema>

export function GroupDialog({
  editing,
  open,
  onOpenChange,
}: {
  editing: Group | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
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
      void client.invalidateQueries({ queryKey: queryKeys.groups })
      void client.invalidateQueries({ queryKey: queryKeys.friends })
      void client.invalidateQueries({ queryKey: queryKeys.stats })
      onOpenChange(false)
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : '保存失败'
      form.setError('name', { message })
    },
  })

  const nameError = form.formState.errors.name?.message
  const descError = form.formState.errors.desc?.message

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑分组' : '新建分组'}</DialogTitle>
          <DialogDescription>分组名会出现在公开友链数据里，建议简短。</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="grid gap-4">
          <FormField id="group-name" label="名称" required error={nameError} hint="最多 100 字">
            <Input
              id="group-name"
              {...form.register('name')}
              {...fieldAria('group-name', nameError, '最多 100 字')}
              maxLength={100}
              placeholder="如：朋友们"
            />
          </FormField>
          <FormField id="group-desc" label="说明" error={descError} hint="显示在分组标题下，可选">
            <Textarea
              id="group-desc"
              {...form.register('desc')}
              {...fieldAria('group-desc', descError, '显示在分组标题下，可选')}
              rows={2}
              maxLength={2000}
              placeholder="一句话说明这个分组"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
