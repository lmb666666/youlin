import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { Cable, Inbox, LayoutDashboard, Link2, LogOut, Monitor, Moon, Rss, HeartPulse, Settings, Sun, UserRoundPlus } from 'lucide-react'
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarFooter, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { SettingsProvider, useSettings } from '@/lib/settings'
import { useTheme } from '@/lib/theme'

const NAV = [
  { to: '/admin/dashboard', label: '总览', icon: LayoutDashboard },
  { to: '/admin/links', label: '友链', icon: Link2 },
  { to: '/admin/circle', label: '朋友圈', icon: Rss },
  { to: '/admin/health', label: '体检', icon: HeartPulse },
  { to: '/admin/applications', label: '申请', icon: UserRoundPlus },
  { to: '/admin/api', label: '接入', icon: Cable },
  { to: '/admin/import', label: '导入', icon: Inbox },
  { to: '/admin/settings', label: '设置', icon: Settings },
]

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const

export function AdminLayout() {
  // 布局自身也要读设置，Provider 必须在消费点之外
  return (
    <SettingsProvider>
      <AdminLayoutInner />
    </SettingsProvider>
  )
}

function AdminLayoutInner() {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, setTheme } = useTheme()
  const settings = useSettings()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    api('/api/admin/me')
      .then(() => setChecked(true))
      .catch(() => {})
  }, [])

  // ui.theme：浏览器无显式选择时，采用服务端设置（本地偏好优先）
  useEffect(() => {
    const server = settings['ui.theme']
    if (
      !localStorage.getItem('youlin-theme') &&
      (server === 'light' || server === 'dark' || server === 'system')
    ) {
      setTheme(server, false)
    }
  }, [settings, setTheme])

  // ui.accentColor：覆盖 shadcn 主色 CSS 变量（留空即清除覆盖）
  useEffect(() => {
    const raw = settings['ui.accentColor']
    const accent = typeof raw === 'string' ? raw.trim() : ''
    const root = document.documentElement
    for (const name of ['--primary', '--ring', '--sidebar-primary']) {
      if (accent) root.style.setProperty(name, accent)
      else root.style.removeProperty(name)
    }
  }, [settings])

  if (!checked) return null

  const ThemeIcon = THEME_ICON[theme]

  return (
    <SidebarProvider>
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <img src="/logo.svg" alt="" className="size-8 shrink-0 rounded-md" />
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <div className="text-sm font-semibold">友邻</div>
            <div className="text-xs text-muted-foreground">友链 · 朋友圈管理台</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton isActive={location.pathname === item.to} onClick={() => navigate(item.to)} tooltip={item.label}>
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => {
                void api('/api/admin/logout', { method: 'POST' }).finally(() => navigate('/admin/login'))
              }}
              tooltip="退出登录"
            >
              <LogOut />
              <span>退出登录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
    <SidebarInset>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-1 h-4!" />
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="切换主题">
              <ThemeIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme('light')}>
              <Sun /> 浅色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              <Moon /> 深色
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>
              <Monitor /> 跟随系统
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <Outlet />
      </main>
    </SidebarInset>
  </SidebarProvider>
  )
}
