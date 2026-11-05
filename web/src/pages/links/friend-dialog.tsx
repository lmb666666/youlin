import { useEffect, useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { z } from 'zod'
import { Sparkles } from 'lucide-react'
import { friendCreateSchema, httpUrl, type Group, type Friend } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query'
import { Field } from './field'

// 表单里的可选 URL 用空串表示“未填写”，提交时再归一为 null
const optionalFormUrl = z.union([httpUrl, z.literal('')]).optional().nullable()
const friendFormSchema = friendCreateSchema
  .omit({ archs: true })
  .extend({
    archsText: z.string().max(2000),
    feed: optionalFormUrl,
    icon: optionalFormUrl,
    avatar: optionalFormUrl,
  })

type FriendFormValues = z.infer<typeof friendFormSchema>

interface ProbeResponse {
  probe: { feed?: string; title?: string; icon?: string; avatar?: string }
}

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

export function FriendDialog(props: {
  groups: Group[]
  editing: Friend | null
  presetGroupId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { groups, editing, presetGroupId, open, onOpenChange } = props
  const client = useQueryClient()
  const groupFieldId = useId()
  const statusFieldId = useId()
  const form = useForm<FriendFormValues>({
    resolver: zodResolver(friendFormSchema),
    defaultValues: valuesOf(null, null, undefined),
  })

  const firstGroupId = groups[0]?.id
  useEffect(() => {
    if (open) form.reset(valuesOf(editing, presetGroupId, firstGroupId))
    // groups 只在打开时用于默认值；依赖首组 id 避免后台刷新重置正在编辑的表单
  }, [open, editing, presetGroupId, firstGroupId, form])

  const probeMutation = useMutation({
    mutationFn: (values: FriendFormValues) =>
      api<ProbeResponse>('/api/admin/friends/probe', {
        method: 'POST',
        body: JSON.stringify({ link: values.link, feed: values.feed || null }),
      }),
    onSuccess: (res) => {
      const p = res.probe
      const current = form.getValues()
      let filled = 0
      if (p.feed && !current.feed) { form.setValue('feed', p.feed); filled++ }
      if (p.title && !current.title) { form.setValue('title', p.title); filled++ }
      if (p.icon && !current.icon) { form.setValue('icon', p.icon); filled++ }
      if (p.avatar && !current.avatar) { form.setValue('avatar', p.avatar); filled++ }
      if (filled > 0) toast.success(`探测完成，已回填 ${filled} 项`)
      else if (p.feed || p.title || p.icon || p.avatar) toast.info('没有需要回填的内容')
      else toast.info('未探测到可回填的信息')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '探测失败'),
  })

  const saveMutation = useMutation({
    mutationFn: (values: FriendFormValues) => {
      const { archsText, ...rest } = values
      const archs = archsText.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
      const body = {
        ...rest,
        nickname: rest.nickname || null,
        title: rest.title || null,
        desc: rest.desc || null,
        feed: rest.feed || null,
        icon: rest.icon || null,
        avatar: rest.avatar || null,
        comment: rest.comment || null,
        archs,
      }
      return editing
        ? api(`/api/admin/friends/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : api('/api/admin/friends', { method: 'POST', body: JSON.stringify(body) })
    },
    onSuccess: () => {
      toast.success(editing ? '友链已更新' : '友链已添加')
      void client.invalidateQueries({ queryKey: queryKeys.friends })
      void client.invalidateQueries({ queryKey: queryKeys.groups })
      void client.invalidateQueries({ queryKey: queryKeys.stats })
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '保存失败'),
  })

  const values = form.watch()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? '编辑友链' : '添加友链'}</DialogTitle>
          <DialogDescription>feed 留空则不参与朋友圈。</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="分组" htmlFor={groupFieldId}>
              <Controller
                control={form.control}
                name="groupId"
                render={({ field }) => (
                  <Select value={field.value ? String(field.value) : ''} onValueChange={(v) => field.onChange(Number(v))}>
                    <SelectTrigger id={groupFieldId} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="状态" htmlFor={statusFieldId}>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Select value={field.value ?? 'active'} onValueChange={field.onChange}>
                    <SelectTrigger id={statusFieldId} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">显示</SelectItem>
                      <SelectItem value="hidden">隐藏</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="站点名 *" error={form.formState.errors.title?.message}>
              <Input {...form.register('title')} placeholder="站点名" />
            </Field>
            <Field label="订阅日期 *" error={form.formState.errors.since?.message}>
              <Input type="date" {...form.register('since')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="作者">
              <Input {...form.register('author')} placeholder="留空则显示站点名" />
            </Field>
            <Field label="趣称">
              <Input {...form.register('nickname')} placeholder="网站趣称" />
            </Field>
          </div>
          <Field label="站点链接 *" error={form.formState.errors.link?.message}>
            <Input {...form.register('link')} placeholder="https://…" />
          </Field>
          <Field label="订阅源 feed" error={form.formState.errors.feed?.message}>
            <Input {...form.register('feed')} placeholder="https://…/atom.xml" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="图标 icon" error={form.formState.errors.icon?.message}>
              <Input {...form.register('icon')} placeholder="favicon 地址" />
            </Field>
            <Field label="头像 avatar" error={form.formState.errors.avatar?.message}>
              <Input {...form.register('avatar')} placeholder="头像地址" />
            </Field>
          </div>
          {values.avatar && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <img src={values.avatar} alt="" className="size-8 rounded-full border object-cover" />
              头像预览
            </div>
          )}
          <Field label="架构（逗号分隔）">
            <Input {...form.register('archsText')} placeholder="Nuxt, VitePress" />
          </Field>
          <Field label="备注">
            <Textarea {...form.register('comment')} rows={2} />
          </Field>
          <Controller
            control={form.control}
            name="inCircle"
            render={({ field }) => (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={field.value === true} onCheckedChange={field.onChange} />
                纳入朋友圈抓取
              </label>
            )}
          />
          <DialogFooter className="items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => probeMutation.mutate(form.getValues())}
              disabled={probeMutation.isPending || !values.link}
              className="mr-auto"
            >
              <Sparkles /> {probeMutation.isPending ? '探测中…' : '自动探测'}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
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
