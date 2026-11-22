import { useQuery } from '@tanstack/react-query'
import {
  api,
  type AdminStats,
  type ApplicationListResponse,
  type ArticleListResponse,
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

export function useFriendsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.friends,
    queryFn: () => api<FriendListResponse>('/api/admin/friends'),
    enabled,
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

export function useApplicationsQuery(status: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.applications(status),
    queryFn: () => api<ApplicationListResponse>(`/api/admin/applications?status=${status}`),
    enabled,
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
