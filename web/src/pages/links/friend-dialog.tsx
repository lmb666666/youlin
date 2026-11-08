import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { z } from 'zod'
import { friendCreateSchema, httpUrl, type Friend, type Group, type ProbeResult } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Avatar } from '@/components/common/avatar'
import { FormField, fieldAria } from '@/components/common/form-field'
import { api, ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/query'

const optionalFormUrl = z.union([httpUrl, z.literal('')]).optional().nullable()
const friendFormSchema = friendCreateSchema
  .omit({ archs: true })
  .extend({
    archsText: z.string().max(2000).refine((value) => {
      const items = value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
      return items.length <= 20 && items.every((item) => item.length <= 100)
    }, '最多 20 项，每项不超过 100 字'),
    feed: optionalFormUrl,
    icon: optionalFormUrl,
    avatar: optionalFormUrl,
  })

type FriendFormValues = z.infer<typeof friendFormSchema>

function valuesOf(friend: Friend | null, presetGroupId: number | null, firstGroupId: number | undefined): FriendFormValues {
  if (friend) {
    return {
      groupId: friend.groupId,
      author: friend.author,
      nickname: friend.nickname ?? '',
      title: friend.title ?? '',
      desc: friend.desc ?? '',
      link: friend.link,
      feed: friend.feed ?? '',
      icon: friend.icon ?? '',
      avatar: friend.avatar ?? '',
      archsText: (friend.archs ?? []).join(', '),
      since: friend.since,
      comment: friend.comment ?? '',
      inCircle: friend.inCircle,
      status: friend.status,
    }
  }
  return {
    groupId: presetGroupId ?? firstGroupId ?? 0,
    author: '',
    nickname: '',
    title: '',
    desc: '',
    link: '',
    feed: '',
    icon: '',
    avatar: '',
    archsText: '',
    since: new Date().toISOString().slice(0, 10),
    comment: '',
    inCircle: true,
    status: 'active',
  }
}

function parseArchs(text: string): string[] {
  return text.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)
}

export function FriendDialog({
  groups,
  editing,
  presetGroupId,
  open,
  onOpenChange,
}: {
  groups: Group[]
  editing: Friend | null
  presetGroupId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const firstGroupId = groups[0]?.id
  const editingRef = useRef(editing)
  editingRef.current = editing
  const firstGroupRef = useRef(firstGroupId)
  firstGroupRef.current = firstGroupId
  const [probePending, setProbePending] = useState(false)
  const probeRef = useRef<AbortController | null>(null)

  const form = useForm<FriendFormValues>({
    resolver: zodResolver(friendFormSchema),
    defaultValues: valuesOf(null, null, undefined),
  })

  useEffect(() => {
    if (!open) return
    form.reset(valuesOf(editingRef.current, presetGroupId, firstGroupRef.current))
    form.clearErrors()
    return () => {
      probeRef.current?.abort()
      setProbePending(false)
    }
  }, [open, editing?.id, presetGroupId, form])

  const saveMutation = useMutation({
    mutationFn: (values: FriendFormValues) => {
      const { archsText, ...rest } = values
      const body = {
        ...rest,
        author: rest.author || null,
        nickname: rest.nickname || null,
        title: rest.title || null,
        desc: rest.desc || null,
        feed: rest.feed || null,
        icon: rest.icon || null,
        avatar: rest.avatar || null,
        comment: rest.comment || null,
        archs: parseArchs(archsText),
      }
      return editing
        ? api(`/api/admin/friends/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/api/admin/friends', { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => {
      for (const key of [queryKeys.friends, queryKeys.groups, queryKeys.stats, queryKeys.health]) {
        void client.invalidateQueries({ queryKey: key })
      }
      onOpenChange(false)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'duplicate_link') {
        form.setError('link', { message: '该链接已存在' })
      } else {
        form.setError('root', { message: error instanceof Error ? error.message : '保存失败' })
      }
    },
  })

  const probe = async () => {
    const values = form.getValues()
    probeRef.current?.abort()
    const controller = new AbortController()
    probeRef.current = controller
    setProbePending(true)
    try {
      const response = await api<{ probe: ProbeResult }>('/api/admin/friends/probe', {
        method: 'POST',
        body: JSON.stringify({ link: values.link, feed: values.feed || null }),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      const result = response.probe
      const current = form.getValues()
      let filled = 0
      if (result.feed && !current.feed) { form.setValue('feed', result.feed); filled++ }
      if (result.title && !current.title) { form.setValue('title', result.title); filled++ }
      if (result.icon && !current.icon) { form.setValue('icon', result.icon); filled++ }
      if (result.avatar && !current.avatar) { form.setValue('avatar', result.avatar); filled++ }
      form.setError('root', {
        message: filled > 0 ? `探测完成，已回填 ${filled} 项` : '未探测到可回填的信息',
      })
    } catch (error) {
      if (controller.signal.aborted) return
      form.setError('root', { message: error instanceof Error ? error.message : '探测失败' })
    } finally {
      if (!controller.signal.aborted) setProbePending(false)
    }
  }

  const values = form.watch()
  const rootError = form.formState.errors.root?.message
  const titleError = form.formState.errors.title?.message
  const linkError = form.formState.errors.link?.message
  const sinceError = form.formState.errors.since?.message
  const groupError = form.formState.errors.groupId?.message
  const archsError = form.formState.errors.archsText?.message

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑友链' : '添加友链'}</DialogTitle>
          <DialogDescription>填写站点地址后可以自动探测 RSS、标题与头像；feed 留空则不参与朋友圈。</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))} className="grid gap-4">
          {rootError && (
            <p role="alert" className="rounded-md border border-info-border bg-info-bg px-3 py-2 text-xs text-info">
              {rootError}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="friend-group" label="分组" required error={groupError}>
              <Controller
                control={form.control}
                name="groupId"
                render={({ field }) => (
                  <Select value={field.value ? String(field.value) : ''} onValueChange={(value) => field.onChange(Number(value))}>
                    <SelectTrigger id="friend-group" className="w-full" aria-invalid={Boolean(groupError)}>
                      <SelectValue placeholder="选择分组" />
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

            <FormField id="friend-status" label="显示状态" hint="隐藏后不出现在公开接口">
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value ?? 'active'} onValueChange={field.onChange}>
                    <SelectTrigger id="friend-status" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">显示</SelectItem>
                      <SelectItem value="hidden">隐藏</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>

            <FormField id="friend-title" label="站点名称" required error={titleError}>
              <Input
                id="friend-title"
                {...form.register('title')}
                {...fieldAria('friend-title', titleError)}
                maxLength={200}
                placeholder="如：Liang 的博客"
              />
            </FormField>

            <FormField id="friend-since" label="订阅日期" required error={sinceError}>
              <Input id="friend-since" type="date" {...form.register('since')} {...fieldAria('friend-since', sinceError)} />
            </FormField>

            <FormField id="friend-author" label="站长昵称" hint="留空则用站点名称">
              <Input id="friend-author" {...form.register('author')} maxLength={200} placeholder="昵称或笔名" />
            </FormField>

            <FormField id="friend-nickname" label="网站趣称" hint="可选，仅管理台显示">
              <Input id="friend-nickname" {...form.register('nickname')} maxLength={200} placeholder="网站趣称" />
            </FormField>
          </div>

          <FormField id="friend-link" label="站点链接" required error={linkError}>
            <Input
              id="friend-link"
              {...form.register('link')}
              {...fieldAria('friend-link', linkError)}
              maxLength={2048}
              placeholder="https://example.com/"
            />
          </FormField>

          <FormField id="friend-desc" label="站点简介" hint="可选，会出现在公开友链数据中">
            <Textarea id="friend-desc" {...form.register('desc')} rows={2} maxLength={2000} placeholder="一两句话介绍这个站点" />
          </FormField>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="friend-feed" label="RSS 地址" hint="留空则不参与朋友圈">
              <Input id="friend-feed" {...form.register('feed')} maxLength={2048} placeholder="https://example.com/atom.xml" />
            </FormField>
            <FormField id="friend-icon" label="图标 icon" hint="favicon 地址，可选">
              <Input id="friend-icon" {...form.register('icon')} maxLength={2048} placeholder="https://example.com/favicon.ico" />
            </FormField>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="friend-avatar" label="头像 avatar" hint="头像地址，可选">
              <Input id="friend-avatar" {...form.register('avatar')} maxLength={2048} placeholder="https://example.com/avatar.webp" />
            </FormField>
            <div className="flex items-end gap-2 pb-1">
              {values.avatar ? (
                <>
                  <Avatar name={values.author || values.title || '?'} src={values.avatar} size="lg" />
                  <span className="text-[11px] text-subtle">头像预览</span>
                </>
              ) : (
                <span className="text-[11px] text-subtle">填写头像地址后预览</span>
              )}
            </div>
          </div>

          <FormField id="friend-archs" label="架构标签" error={archsError} hint="用逗号分隔，最多 20 项">
            <Input
              id="friend-archs"
              {...form.register('archsText')}
              {...fieldAria('friend-archs', archsError, '用逗号分隔，最多 20 项')}
              maxLength={2000}
              placeholder="Nuxt, VitePress"
            />
          </FormField>

          <FormField id="friend-comment" label="备注" hint="仅管理台可见">
            <Textarea id="friend-comment" {...form.register('comment')} rows={2} maxLength={2000} />
          </FormField>

          <Controller
            control={form.control}
            name="inCircle"
            render={({ field }) => (
              <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm">
                <span>
                  纳入朋友圈抓取
                  <span className="mt-0.5 block text-[11px] text-subtle">关闭后不抓取该站点的文章</span>
                </span>
                <Switch checked={field.value === true} onCheckedChange={field.onChange} aria-label="纳入朋友圈抓取" />
              </label>
            )}
          />

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => void probe()}
              disabled={probePending || !values.link}
            >
              <Sparkles className={probePending ? 'animate-pulse' : undefined} />
              {probePending ? '探测中…' : '自动探测'}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
                取消
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? '保存中…' : '保存'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
