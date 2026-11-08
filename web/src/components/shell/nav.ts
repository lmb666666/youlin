import {
  Cable,
  DatabaseBackup,
  HeartPulse,
  LayoutDashboard,
  Link2,
  Rss,
  Settings,
  UserRoundPlus,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/admin/dashboard', label: '总览', icon: LayoutDashboard },
  { to: '/admin/links', label: '友链', icon: Link2 },
  { to: '/admin/circle', label: '朋友圈', icon: Rss },
  { to: '/admin/health', label: '体检', icon: HeartPulse },
  { to: '/admin/applications', label: '申请', icon: UserRoundPlus },
  { to: '/admin/api', label: '接入', icon: Cable },
  { to: '/admin/backup', label: '备份', icon: DatabaseBackup },
  { to: '/admin/settings', label: '设置', icon: Settings },
]

export function navLabel(pathname: string): string {
  return NAV_ITEMS.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))?.label ?? '总览'
}
