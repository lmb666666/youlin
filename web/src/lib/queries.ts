import { useQuery } from '@tanstack/react-query'
import {
  api,
  type AdminStats,
  type ApplicationListResponse,
  type ArticleListResponse,
  type CrawlStatus,
  type FriendListResponse,
  type GroupListResponse,
  type HealthListResponse,
  type SettingsResponse,
  type SettingsSchemaResponse,
} from './api'
import { queryKeys } from './query'
import type { BackupStatusResponse, DavListResponse } from '@youlin/contracts'

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<{ ok: true }>('/api/admin/me'),
    retry: false,
  })
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => api<SettingsResponse>('/api/admin/settings'),
  })
}

export function useSettingsSchemaQuery() {
  return useQuery({
    queryKey: queryKeys.settingsSchema,
    queryFn: () => api<SettingsSchemaResponse>('/api/admin/settings/schema'),
    staleTime: Infinity,
  })
}

export function useGroupsQuery() {
  return useQuery({
    queryKey: queryKeys.groups,
    queryFn: () => api<GroupListResponse>('/api/admin/groups'),
  })
}

export function useFriendsQuery() {
  return useQuery({
    queryKey: queryKeys.friends,
    queryFn: () => api<FriendListResponse>('/api/admin/friends'),
  })
}

export function useAdminStatsQuery() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api<AdminStats>('/api/admin/stats'),
  })
}

export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api<HealthListResponse>('/api/admin/health'),
  })
}

export function useArticlesQuery() {
  return useQuery({
    queryKey: queryKeys.articles,
    queryFn: () => api<ArticleListResponse>('/api/admin/articles'),
  })
}

export function useCrawlStatusQuery(pollWhenIdle = false) {
  return useQuery({
    queryKey: queryKeys.crawlStatus,
    queryFn: () => api<CrawlStatus>('/api/admin/crawl/status'),
    // 轮转进行中才轮询；完成/失败后自动停下（手动触发的启动竞态可临时 pollWhenIdle）
    refetchInterval: (query) => (query.state.data?.running || pollWhenIdle ? 1500 : false),
  })
}

export function useApplicationsQuery(status: string) {
  return useQuery({
    queryKey: queryKeys.applications(status),
    queryFn: () => api<ApplicationListResponse>(`/api/admin/applications?status=${status}`),
    placeholderData: (prev) => prev,
  })
}

export function useBackupStatusQuery() {
  return useQuery({
    queryKey: queryKeys.backupStatus,
    queryFn: () => api<BackupStatusResponse>('/api/admin/backup/status'),
  })
}

export function useDavFilesQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.davFiles,
    queryFn: () => api<DavListResponse>('/api/admin/backup/webdav/list'),
    enabled,
    retry: 0,
  })
}
