/** 管理 API 封装：JSON 请求、超时/取消、二进制上传下载、错误归一、401 跳登录 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

/** 非 JSON 请求失败时提取服务端错误文案 */
export async function readError(res: Response): Promise<string> {
  let message = `请求失败（${res.status}）`
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    if (body.error?.message) message = body.error.message
  } catch {
    /* 保持默认文案 */
  }
  return message
}

function redirectToLogin(path: string): void {
  if (path.startsWith('/api/admin/login')) return
  if (typeof window === 'undefined') return
  const next = `${window.location.pathname}${window.location.search}`
  if (window.location.pathname === '/admin/login') return
  window.location.assign(`/admin/login?next=${encodeURIComponent(next)}`)
}

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('请求超时，请稍后重试', 'TimeoutError'))
  }, timeoutMs)
  const onAbort = () => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

type ErrorBody = { error?: { code?: string; message?: string; details?: unknown } }

async function parseError(res: Response): Promise<ApiError> {
  let body: ErrorBody | null = null
  try {
    body = (await res.json()) as ErrorBody
  } catch {
    /* 非 JSON 错误体 */
  }
  const err = body?.error
  return new ApiError(
    res.status,
    err?.code ?? 'unknown',
    err?.message ?? `请求失败（${res.status}）`,
    err?.details,
  )
}

async function request<T>(path: string, init: RequestInit, timeoutMs = 20_000): Promise<T> {
  const { signal, cleanup } = combineSignal(init.signal ?? undefined, timeoutMs)
  try {
    const res = await fetch(path, { ...init, signal })
    if (res.status === 401) {
      redirectToLogin(path)
      throw new ApiError(401, 'unauthorized', '未登录或会话已过期')
    }
    if (!res.ok) throw await parseError(res)
    if (res.status === 204) return undefined as T
    const text = await res.text()
    if (text === '') return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ApiError(res.status, 'invalid_response', '服务端返回了无法解析的数据')
    }
  } finally {
    cleanup()
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(
    path,
    {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    },
  )
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  if (utf8) {
    try {
      return decodeURIComponent(utf8)
    } catch {
      return utf8
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header)?.[1] ?? /filename=([^;]+)/i.exec(header)?.[1]
  return plain?.trim() ?? null
}

export interface DownloadResult {
  blob: Blob
  filename: string | null
}

/** 下载二进制响应（备份文件、导出文件）；错误响应按 JSON 解析 */
export async function apiDownload(path: string, init: RequestInit = {}): Promise<DownloadResult> {
  const { signal, cleanup } = combineSignal(init.signal ?? undefined, 120_000)
  try {
    const res = await fetch(path, { ...init, signal })
    if (res.status === 401) {
      redirectToLogin(path)
      throw new ApiError(401, 'unauthorized', '未登录或会话已过期')
    }
    if (!res.ok) throw await parseError(res)
    return {
      blob: await res.blob(),
      filename: filenameFromDisposition(res.headers.get('content-disposition')),
    }
  } finally {
    cleanup()
  }
}

/** 上传原始字节（备份预览/恢复）。服务端读取 raw body，不设 Content-Type。 */
export async function apiUpload<T = unknown>(
  path: string,
  body: Blob | File | ArrayBuffer | Uint8Array,
  init: RequestInit = {},
  timeoutMs = 120_000,
): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      ...init,
      body: body as BodyInit,
    },
    timeoutMs,
  )
}

// ── 类型：服务端与前端共用 @youlin/contracts ─────────────────────────────
export type {
  Group,
  GroupListResponse,
  GroupCreateInput,
  GroupUpdateInput,
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
  ProbeResult,
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
  BackupStatus,
  BackupStatusResponse,
  BackupPreview,
  DavFile,
  DavListResponse,
  RestoreResponse,
  RestoreSummary,
} from '@youlin/contracts'
