import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSettingsQuery } from './queries'
import { queryKeys } from './query'
import type { SettingsValues } from './api'

/**
 * 管理台设置上下文：全局只保留一份 query 缓存，各页面按需消费
 * （如 ui.pageSize 分页、ui.accentColor 主题色）。
 * 设置页保存或导入后调用 useSettingsRefresh() 让缓存失效。
 */

const SettingsContext = createContext<SettingsValues>({})
const RefreshContext = createContext<() => void>(() => {})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data } = useSettingsQuery()
  const client = useQueryClient()

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.settings })
  }, [client])

  return (
    <SettingsContext value={data?.values ?? {}}>
      <RefreshContext value={refresh}>{children}</RefreshContext>
    </SettingsContext>
  )
}

export function useSettings(): SettingsValues {
  return useContext(SettingsContext)
}

export function useSettingsRefresh(): () => void {
  return useContext(RefreshContext)
}
