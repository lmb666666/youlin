import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar } from '@/components/common/avatar'
import { ErrorState } from '@/components/common/page-state'
import { CommandPalette } from './command-palette'
import { JobStatus } from './job-status'
import { NAV_ITEMS, navLabel } from './nav'
import { useAdminStatsQuery, useMe } from '@/lib/queries'
import { useSettings } from '@/lib/settings'
import { useTheme, type Theme } from '@/lib/theme'
import { applyAccentColor, clearAccentColor } from '@/lib/accent'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useJobWatcher } from '@/lib/jobs'

const THEME_ITEMS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const settings = useSettings()
  const stats = useAdminStatsQuery()
  const siteName = typeof settings['site.name'] === 'string' && settings['site.name'] ? settings['site.name'] : '我的博客'
  const pending = stats.data?.applications.pending ?? 0

  const logout = useMutation({
    mutationFn: () => api('/api/admin/logout', { method: 'POST' }),
    onSettled: () => {
      client.clear()
      navigate('/admin/login')
    },
  })

  return (
    <>
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <img src="/favicon.svg" alt="" className="size-8 shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="font-serif text-xl font-semibold tracking-tight">友邻</p>
          <p className="mt-0.5 text-[11px] text-subtle">友链 · 朋友圈</p>
        </div>
        {onNavigate && (
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="关闭导航" onClick={onNavigate}>
            <X />
          </Button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="主导航">
        <div className="grid gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                'group flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground transition-colors',
                'hover:bg-sidebar-accent hover:text-foreground',
                'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground',
              )}
            >
              <item.icon className="size-4 shrink-0 group-aria-[current=page]:text-primary" />
              {item.label}
              {item.label === '申请' && pending > 0 && (
                <span className="ml-auto rounded-full border border-danger-border bg-danger-bg px-1.5 py-0.5 text-[10px] font-medium leading-none text-danger">
                  {pending}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-sidebar-accent/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
          <span className="truncate">{siteName}</span>
        </div>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start gap-2 px-3 text-xs text-muted-foreground"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          <LogOut className="size-4" />
          退出登录
        </Button>
      </div>
    </>
  )
}

export function AppShell() {
  const location = useLocation()
  const { theme, setTheme } = useTheme()
  const settings = useSettings()
  const me = useMe()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useJobWatcher()

  const siteName = typeof settings['site.name'] === 'string' && settings['site.name'] ? settings['site.name'] : '我的博客'
  const title = navLabel(location.pathname)

  // 服务端 ui.theme 只在浏览器没有显式偏好时生效
  useEffect(() => {
    const server = settings['ui.theme']
    if (!localStorage.getItem('youlin-theme') && (server === 'light' || server === 'dark' || server === 'system')) {
      setTheme(server, false)
    }
  }, [settings, setTheme])

  // 强调色：hex 才生效，前景色自动取对比度更高的一侧
  const accent = typeof settings['ui.accentColor'] === 'string' ? settings['ui.accentColor'] : ''
  useEffect(() => {
    applyAccentColor(accent)
  }, [accent])
  useEffect(() => () => clearAccentColor(), [])

  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (me.isPending) {
    return <div className="grid min-h-dvh place-items-center text-sm text-subtle">正在验证登录状态…</div>
  }

  if (me.isError) {
    if (!(me.error instanceof ApiError) || me.error.status !== 401) {
      return (
        <div className="grid min-h-dvh place-items-center p-6">
          <ErrorState title="无法连接管理 API" error={me.error} onRetry={() => void me.refetch()} />
        </div>
      )
    }
    return null
  }

  return (
    <div className="min-h-dvh bg-background lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col border-r bg-sidebar lg:flex">
        <SidebarContent />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            aria-label="关闭导航"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[min(288px,86vw)] flex-col border-r bg-sidebar shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="导航"
          >
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur-md sm:px-5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="打开导航"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu />
          </Button>

          <div className="flex min-w-0 items-center gap-2 text-xs text-subtle">
            <span className="hidden sm:inline">友邻</span>
            <span className="hidden text-border sm:inline">/</span>
            <strong className="truncate text-sm font-medium text-foreground">{title}</strong>
          </div>

          <span className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => setPaletteOpen(true)}
            aria-label="打开命令面板"
          >
            <Search className="size-4" />
            <span className="hidden text-xs sm:inline">搜索</span>
            <kbd className="hidden rounded border px-1.5 py-0.5 font-mono text-[10px] text-subtle sm:inline">⌘K</kbd>
          </Button>

          <JobStatus />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="切换主题">
                {theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>主题</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {THEME_ITEMS.map((item) => (
                <DropdownMenuItem key={item.value} onClick={() => setTheme(item.value)}>
                  <item.icon />
                  {item.label}
                  {theme === item.value && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-0.5 hidden items-center gap-2 sm:flex">
            <Avatar name={siteName} size="sm" />
            <span className="max-w-32 truncate text-xs text-muted-foreground">{siteName}</span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}
