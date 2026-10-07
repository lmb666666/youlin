import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

/**
 * 管理台设置上下文：登录后拉取一次全量设置，各页面按需消费
 * （如 ui.pageSize 分页、ui.accentColor 主题色）。
 * 设置页保存或导入配置后调用 useSettingsRefresh() 返回的函数重新拉取。
 */

const SettingsContext = createContext<Record<string, unknown>>({})
const RefreshContext = createContext<() => void>(() => {})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, unknown>>({})

  const refresh = useCallback(() => {
    api<{ values: Record<string, unknown> }>('/api/admin/settings')
      .then((r) => setValues(r.values))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <SettingsContext value={values}>
      <RefreshContext value={refresh}>{children}</RefreshContext>
    </SettingsContext>
  )
}

export function useSettings(): Record<string, unknown> {
  return useContext(SettingsContext)
}

export function useSettingsRefresh(): () => void {
  return useContext(RefreshContext)
}
