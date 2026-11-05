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

/** 非 JSON 请求（文件上传/下载）失败时提取服务端错误文案 */
export async function readError(res: Response): Promise<string> {
  let message = `请求失败（${res.status}）`
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body.error?.message) message = body.error.message
  } catch { /* 保持默认文案 */ }
  return message
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

// ── 类型：服务端与前端共用 @youlin/contracts ─────────────────────────────
export type {
  Group,
  GroupListResponse,
  Friend,
  FriendState,
  FriendListResponse,
  FriendCreateInput,
  FriendPatchInput,
  SourceState,
  HealthFriend,
  HealthListResponse,
  ArticleRow,
  ArticleListResponse,
  CrawlStatus,
  Application,
  ApplicationListResponse,
  ApplicationApproveInput,
  ApplicationRejectInput,
  SettingsSchemaField,
  SettingsSchemaGroup,
  SettingsSchemaResponse,
  SettingsValues,
  SettingsResponse,
  AdminStats,
  ImportResult,
} from '@youlin/contracts'
