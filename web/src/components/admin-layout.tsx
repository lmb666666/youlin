import { SettingsProvider } from '@/lib/settings'
import { AppShell } from './shell/app-shell'

/** 管理台布局：设置上下文 + 应用外壳 */
export function AdminLayout() {
  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  )
}
