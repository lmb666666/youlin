import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
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
  applications: (status: string) => ['applications', status] as const,
  backupStatus: ['backup', 'status'] as const,
  davFiles: ['backup', 'dav-files'] as const,
}
