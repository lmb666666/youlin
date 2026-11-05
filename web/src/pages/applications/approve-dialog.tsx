import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { applicationApproveSchema, type ApplicationApproveInput, type Group } from '@youlin/contracts'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, type Application } from '@/lib/api'
import { queryKeys } from '@/lib/query'

interface ApproveResult {
  friendId: number
  rebuild: { triggered: boolean } | null
}

export function ApproveDialog(props: {
  app: Application | null
  groups: Group[]
  rebuildEnabled: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { app, groups, rebuildEnabled, onOpenChange } = props
  const client = useQueryClient()
  const form = useForm<ApplicationApproveInput>({
    resolver: zodResolver(applicationApproveSchema),
    defaultValues: { author: '', title: '', desc: '', feed: '', rebuild: false },
  })

  useEffect(() => {
    if (!app) return
    form.reset({
      groupId: groups[0]?.id,
      author: app.author ?? '',
      title: app.siteName,
      desc: app.desc ?? '',
      feed: app.feed ?? '',
      rebuild: false,
    })
  }, [app, groups, form])

  const mutation = useMutation({
    mutationFn: (values: ApplicationApproveInput) =>
      api<ApproveResult>(`/api/admin/applications/${app!.id}/approve`, {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: (res) => {
      toast.success(`已通过并入库存为友链 #${res.friendId}${res.rebuild?.triggered ? '，已触发重建' : ''}`)
      void client.invalidateQueries({ queryKey: ['applications'] })
      void client.invalidateQueries({ queryKey: queryKeys.friends })
      void client.invalidateQueries({ queryKey: queryKeys.groups })
      void client.invalidateQueries({ queryKey: queryKeys.stats })
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '通过失败'),
  })

  return (
    <Dialog open={app !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>通过申请：{app?.siteName}</DialogTitle>
          <DialogDescription>字段已预填，可直接修改。</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">分组 *</Label>
            <Controller
              control={form.control}
              name="groupId"
              render={({ field }) => (
                <Select value={field.value === undefined ? '' : String(field.value)} onValueChange={(v) => field.onChange(Number(v))}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="选择分组" /></SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">作者</Label>
              <Input {...form.register('author')} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">站点标题</Label>
              <Input {...form.register('title')} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">feed（留空则不参与朋友圈）</Label>
            <Input {...form.register('feed')} placeholder="https://…/atom.xml" />
            {form.formState.errors.feed && <p className="text-xs text-destructive">{form.formState.errors.feed.message}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">简介</Label>
            <Textarea {...form.register('desc')} rows={2} />
          </div>
          {rebuildEnabled && (
            <Controller
              control={form.control}
              name="rebuild"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={field.value === true} onCheckedChange={field.onChange} />
                  通过后触发接入方重建
                </label>
              )}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={mutation.isPending || form.watch('groupId') === undefined}>
              <Check /> {mutation.isPending ? '处理中…' : '通过并入库'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
