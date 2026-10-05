/** 管理 API 封装：JSON 请求、错误归一、401 跳登录 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string>,
  ) {
    super(message)
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (res.status === 401 && !path.startsWith('/api/admin/login')) {
    window.location.assign('/admin/login')
    throw new ApiError(401, 'unauthorized', '未登录')
  }
  const body = (await res.json().catch(() => null)) as
    | { error?: { code: string; message: string; details?: Record<string, string> } }
    | null
  if (!res.ok) {
    const err = body?.error
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? `请求失败（${res.status}）`, err?.details)
  }
  return body as T
}

// ── 类型（与管理 API 输出一致）───────────────────────────────────────────

export interface Group {
  id: number
  name: string
  desc?: string
  sort: number
  friendCount: number
}

export interface FriendState {
  reachable: boolean | null
  crawlable: boolean | null
  failCount: number
  checkedAt?: string
}

export interface SourceState {
  reachable: boolean | null
  crawlable: boolean | null
  bestMethod: 'rss' | 'homepage' | 'api' | 'none' | null
  httpStatus: number | null
  latencyMs: number | null
  finalUrl: string | null
  backlinkChecked: boolean
  backlink: boolean | null
  unreachableSince: string | null
  rssUnavailableSince: string | null
  lastPostPublished: string | null
  lastPostDaysAgo: number | null
  lastOkAt: string | null
  lastError: string | null
  failCount: number
  nextCheckAt: string | null
  checkedAt: string | null
}

export interface HealthFriend {
  id: number
  author: string
  title?: string
  link: string
  feed?: string
  inCircle: boolean
  status: 'active' | 'hidden'
  state: SourceState | null
}

export interface ArticleRow {
  id: number
  friendId: number
  friendAuthor: string
  title: string
  link: string
  author?: string
  publishedAt?: string
  fetchedAt?: string
}

export interface CrawlStatus {
  running: boolean
  round: { kind: string; startedAt: string; done: number; total: number } | null
  activeCount: number
  dueCount: number
}

export interface Friend {
  id: number
  groupId: number
  groupName?: string
  author: string
  nickname?: string
  title?: string
  desc?: string
  link: string
  feed?: string
  icon?: string
  avatar?: string
  archs?: string[]
  since: string
  comment?: string
  inCircle: boolean
  status: 'active' | 'hidden'
  sort: number
  createdAt?: string
  updatedAt?: string
  state?: FriendState | null
}

export interface SettingsSchemaField {
  key: string
  type: 'string' | 'text' | 'number' | 'boolean' | 'enum' | 'stringList' | 'json'
  default: unknown
  label: string
  description: string
  options?: string[]
  min?: number
  max?: number
  placeholder?: string
  full?: boolean
}

export interface SettingsSchemaGroup {
  key: string
  label: string
  description: string
  fields: SettingsSchemaField[]
}

export interface Application {
  id: number
  siteName: string
  author?: string
  link: string
  avatar?: string
  feed?: string
  desc?: string
  contact?: string
  note?: string
  backlink: { ok: boolean | null; checkedAt: string | null; detail: string | null }
  status: 'pending' | 'approved' | 'rejected'
  reviewNote?: string
  createdAt?: string
  reviewedAt?: string
}

export interface ImportResult {
  imported: number
  updated: number
  skipped: number
  groupsCreated: number
  errors: { index: number; message: string }[]
}
