import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export const queryKeys = {
  me: ['me'] as const,
  settings: ['settings'] as const,
  settingsSchema: ['settings', 'schema'] as const,
  groups: ['groups'] as const,
  friends: ['friends'] as const,
  stats: ['stats'] as const,
  health: ['health'] as const,
  articles: ['articles'] as const,
  crawlStatus: ['crawl-status'] as const,
  applications: (status: string = 'all') => ['applications', status] as const,
  backupStatus: ['backup', 'status'] as const,
  davFiles: ['backup', 'dav-files'] as const,
}

/** 友链/分组变更会级联影响朋友圈、体检与统计缓存 */
export function invalidateLinkData(client: QueryClient): void {
  for (const key of [queryKeys.friends, queryKeys.groups, queryKeys.stats, queryKeys.health, queryKeys.articles]) {
    void client.invalidateQueries({ queryKey: key })
  }
}

/** 一轮抓取/体检完成后需要刷新的数据 */
export function invalidateAfterJob(client: QueryClient): void {
  for (const key of [queryKeys.health, queryKeys.articles, queryKeys.stats, queryKeys.friends]) {
    void client.invalidateQueries({ queryKey: key })
  }
}
