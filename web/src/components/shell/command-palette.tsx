import { Command } from 'cmdk'
import {
  ArrowRight,
  Cable,
  DatabaseBackup,
  HeartPulse,
  LayoutDashboard,
  Link2,
  Moon,
  Rss,
  Search,
  Settings,
  Sun,
  Upload,
  UserRoundPlus,
} from 'lucide-react'
import { useNavigate } from 'react-router'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useFriendsQuery } from '@/lib/queries'
import { useTheme } from '@/lib/theme'
import { useApiMutation } from '@/lib/mutations'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query'
import { NAV_ITEMS } from './nav'

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const friends = useFriendsQuery()

  const crawl = useApiMutation<{ started: number }, void>({
    mutationFn: () => api('/api/admin/crawl', { method: 'POST' }),
    invalidate: [queryKeys.crawlStatus],
    successMessage: '已开始抓取一轮',
  })

  const health = useApiMutation<{ started: number }, void>({
    mutationFn: () => api('/api/admin/health/run', { method: 'POST' }),
    invalidate: [queryKeys.crawlStatus],
    successMessage: '已开始全量体检',
  })

  const run = (action: () => void) => {
    onOpenChange(false)
    action()
  }

  const go = (to: string) => run(() => navigate(to))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <Command loop className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-subtle" />
            <Command.Input
              autoFocus
              placeholder="搜索页面、动作或友链…"
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-subtle"
            />
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-subtle">Esc</kbd>
          </div>
          <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-subtle">没有匹配的内容</Command.Empty>

            <Command.Group heading="页面">
              {NAV_ITEMS.map((item) => (
                <Command.Item
                  key={item.to}
                  value={`页面 ${item.label}`}
                  onSelect={() => go(item.to)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
                >
                  <item.icon className="size-4 text-subtle" />
                  {item.label}
                  <ArrowRight className="ml-auto size-3 text-subtle" />
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="快速动作">
              <Command.Item
                value="动作 添加友链"
                onSelect={() => go('/admin/links?new=1')}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <UserRoundPlus className="size-4 text-subtle" /> 添加友链
              </Command.Item>
              <Command.Item
                value="动作 导入数据"
                onSelect={() => go('/admin/links?import=1')}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <Upload className="size-4 text-subtle" /> 导入数据
              </Command.Item>
              <Command.Item
                value="动作 抓取一轮"
                onSelect={() => run(() => crawl.mutate())}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <Rss className="size-4 text-subtle" /> 抓取一轮
              </Command.Item>
              <Command.Item
                value="动作 全量体检"
                onSelect={() => run(() => health.mutate())}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                <HeartPulse className="size-4 text-subtle" /> 全量体检
              </Command.Item>
              <Command.Item
                value="动作 切换主题"
                onSelect={() => run(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
              >
                {theme === 'dark' ? <Sun className="size-4 text-subtle" /> : <Moon className="size-4 text-subtle" />}
                切换到{theme === 'dark' ? '浅色' : '深色'}模式
              </Command.Item>
            </Command.Group>

            <Command.Group heading="快捷入口">
              <Command.Item value="入口 接入文档" onSelect={() => go('/admin/api')} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                <Cable className="size-4 text-subtle" /> 接入文档
              </Command.Item>
              <Command.Item value="入口 备份恢复" onSelect={() => go('/admin/backup')} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                <DatabaseBackup className="size-4 text-subtle" /> 备份与恢复
              </Command.Item>
              <Command.Item value="入口 设置" onSelect={() => go('/admin/settings')} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                <Settings className="size-4 text-subtle" /> 设置
              </Command.Item>
            </Command.Group>

            {(friends.data?.friends.length ?? 0) > 0 && (
              <Command.Group heading="友链">
                {friends.data?.friends.slice(0, 30).map((friend) => (
                  <Command.Item
                    key={friend.id}
                    value={`友链 ${friend.author} ${friend.title ?? ''} ${friend.link}`}
                    onSelect={() => go(`/admin/links?q=${encodeURIComponent(friend.author)}`)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent"
                  >
                    <Link2 className="size-4 text-subtle" />
                    <span className="truncate">{friend.author}</span>
                    <span className="truncate text-xs text-subtle">{friend.title}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="总览">
              <Command.Item value="总览 dashboard" onSelect={() => go('/admin/dashboard')} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                <LayoutDashboard className="size-4 text-subtle" /> 回到总览
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
