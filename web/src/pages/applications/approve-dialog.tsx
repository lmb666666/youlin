import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { applicationApproveSchema, type ApplicationApproveInput, type Group } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/common/form-field'
import { api, type Application } from '@/lib/api'
import { invalidateLinkData, queryKeys } from '@/lib/query'

interface ApproveResult {
  friendId: number
  rebuild: { triggered: boolean } | null
}

export function ApproveDialog({
  app,
  groups,
  rebuildEnabled,
  onOpenChange,
}: {
  app: Application | null
  groups: Group[]
  rebuildEnabled: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const form = useForm<ApplicationApproveInput>({
    resolver: zodResolver(applicationApproveSchema),
    defaultValues: { author: '', title: '', desc: '', feed: '', avatar: '', since: undefined, rebuild: false },
  })

  useEffect(() => {
    if (!app) return
    form.reset({
      groupId: groups[0]?.id,
      author: app.author ?? '',
      title: app.siteName,
      desc: app.desc ?? '',
      feed: app.feed ?? '',
      avatar: app.avatar ?? '',
      rebuild: false,
    })
  }, [app?.id, form]) // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (values: ApplicationApproveInput) =>
      api<ApproveResult>(`/api/admin/applications/${app!.id}/approve`, {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async (result) => {
      toast.success(`已通过并入库存为友链 #${result.friendId}${result.rebuild?.triggered ? '，已触发重建' : ''}`)
      await client.invalidateQueries({ queryKey: queryKeys.applications('all') })
      await client.invalidateQueries({ queryKey: queryKeys.stats })
      invalidateLinkData(client)
      onOpenChange(false)
    },
    onError: (error) => form.setError('root', { message: error instanceof Error ? error.message : '通过失败' }),
  })

  const titleError = form.formState.errors.title?.message
  const feedError = form.formState.errors.feed?.message
  const avatarError = form.formState.errors.avatar?.message
  const sinceError = form.formState.errors.since?.message

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>通过申请：{app?.siteName}</DialogTitle>
          <DialogDescription>字段已预填，可直接修改；通过后会立即出现在公开接口。</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit((values) =>
            mutation.mutate({ ...values, since: values.since || undefined }),
          )}
          className="grid gap-4"
        >
          {form.formState.errors.root?.message && (
            <p role="alert" className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger">
              {form.formState.errors.root.message}
            </p>
          )}

          <FormField id="approve-group" label="分组" hint={groups.length === 0 ? '暂无分组，通过时会自动创建「未分组」' : undefined}>
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <Select
                  value={field.value === undefined ? '' : String(field.value)}
                  onValueChange={(value) => field.onChange(Number(value))}
                >
                  <SelectTrigger id="approve-group" className="w-full">
                    <SelectValue placeholder={groups.length === 0 ? '未分组（自动创建）' : '选择分组'} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="approve-author" label="作者" hint="留空则使用站点名">
              <Input id="approve-author" {...form.register('author')} maxLength={200} />
            </FormField>
            <FormField id="approve-title" label="站点标题" required error={titleError}>
              <Input id="approve-title" {...form.register('title')} maxLength={200} aria-invalid={Boolean(titleError)} />
            </FormField>
            <FormField id="approve-feed" label="RSS 地址" error={feedError} hint="留空则不参与朋友圈">
              <Input id="approve-feed" {...form.register('feed')} maxLength={2048} placeholder="https://…/atom.xml" aria-invalid={Boolean(feedError)} />
            </FormField>
            <FormField id="approve-avatar" label="头像" error={avatarError}>
              <Input id="approve-avatar" {...form.register('avatar')} maxLength={2048} placeholder="https://…/avatar.webp" aria-invalid={Boolean(avatarError)} />
            </FormField>
            <FormField id="approve-since" label="订阅日期" error={sinceError} hint="留空则使用今天">
              <Input id="approve-since" type="date" {...form.register('since')} aria-invalid={Boolean(sinceError)} />
            </FormField>
          </div>

          <FormField id="approve-desc" label="简介">
            <Textarea id="approve-desc" {...form.register('desc')} rows={2} maxLength={2000} />
          </FormField>

          {rebuildEnabled && (
            <Controller
              control={form.control}
              name="rebuild"
              render={({ field }) => (
                <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
                  <span>
                    通过后触发接入方重建
                    <span className="mt-0.5 block text-[11px] text-subtle">仅在使用构建时接入时需要</span>
                  </span>
                  <Switch checked={field.value === true} onCheckedChange={field.onChange} aria-label="通过后触发重建" />
                </label>
              )}
            />
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>取消</Button>
            <Button type="submit" disabled={mutation.isPending}>
              <Check /> {mutation.isPending ? '处理中…' : '通过并入库'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
