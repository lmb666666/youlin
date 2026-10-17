import { XMLParser } from 'fast-xml-parser'

/**
 * 极简 WebDAV 客户端（fetch 实现，Workers 与 Node 通用）
 *
 * 只覆盖备份需要的方法：MKCOL 建目录、PUT 上传、PROPFIND 列目录、GET 下载、DELETE 删除。
 * 认证用 Basic；密码来自 WEBDAV_PASSWORD（环境变量），不落库、不进备份。
 */

export class WebDavError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message)
  }
}

export interface WebDavOptions {
  url: string
  username: string
  password: string
  /** 子目录，留空即用 url 本身 */
  path?: string
  /** 便于测试注入；默认在调用时读取全局 fetch */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface WebDavFile {
  name: string
  size: number
  lastModified?: string
}

const BACKUP_PREFIX = 'youlin-backup-'
export const BACKUP_FILE_PATTERN = /^(?:youlin-backup-|pre-restore-)[\w-]+\.json\.gz$/

/** 路径按段编码，保留 url 自带的路径 */
export function joinDavUrl(base: string, ...segments: string[]): string {
  const root = base.replace(/\/+$/, '')
  const extra = segments
    .flatMap((s) => s.split('/'))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/')
  return extra ? `${root}/${extra}` : root
}

/** Basic 认证：凭据按 UTF-8 编码再 base64（btoa 直接吃中文会抛 InvalidCharacterError） */
function basicToken(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

/** PROPFIND 的属性在 propstat.prop 里（propstat 可能是数组，也可能有多个 status 段） */
function propOf(node: Record<string, unknown>): Record<string, unknown> {
  for (const stat of toArray(node.propstat as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const prop = stat?.prop
    if (prop !== null && prop !== undefined && typeof prop === 'object') return prop as Record<string, unknown>
  }
  return {}
}

export class WebDavClient {
  private readonly base: string
  private readonly username: string
  private readonly password: string
  private readonly fetchImpl?: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: WebDavOptions) {
    const url = opts.url.trim()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new WebDavError('WebDAV 地址不是合法 URL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new WebDavError('WebDAV 地址需以 http:// 或 https:// 开头')
    }
    this.base = joinDavUrl(parsed.toString(), opts.path ?? '')
    this.username = opts.username.trim()
    this.password = opts.password
    this.fetchImpl = opts.fetchImpl
    this.timeoutMs = opts.timeoutMs ?? 30_000
  }

  private doFetch(input: string, init: RequestInit): Promise<Response> {
    const impl = this.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    return impl(input, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const token = basicToken(this.username, this.password)
    return {
      Authorization: `Basic ${token}`,
      'User-Agent': 'Youlin/1.0 (backup)',
      ...extra,
    }
  }

  private async request(method: string, url: string, init: RequestInit = {}): Promise<Response> {
    let res: Response
    try {
      res = await this.doFetch(url, { ...init, method, headers: this.headers(init.headers as Record<string, string> | undefined) })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new WebDavError(`无法连接 WebDAV：${reason}`)
    }
    if (res.status === 401) throw new WebDavError('WebDAV 认证失败，请检查用户名与 WEBDAV_PASSWORD', 401)
    if (res.status === 403) throw new WebDavError('WebDAV 拒绝访问（403），请检查目录权限', 403)
    if (res.status === 404) throw new WebDavError('WebDAV 路径不存在（404）', 404)
    if (res.status >= 500) throw new WebDavError(`WebDAV 服务异常（${res.status}）`, res.status)
    return res
  }

  /** 建目录（已存在视为成功） */
  async ensureDir(): Promise<void> {
    const res = await this.request('MKCOL', this.base)
    // 201 新建；405 已存在；部分服务端对已存在返回 301/302
    if (![201, 200, 204, 405].includes(res.status) && !(res.status >= 300 && res.status < 400)) {
      if (res.status === 409) {
        throw new WebDavError('创建 WebDAV 目录失败（409）：上级目录不存在，请先在 WebDAV 里建好，或把「WebDAV 目录」改成已存在的位置', 409)
      }
      throw new WebDavError(`创建 WebDAV 目录失败（${res.status}）`, res.status)
    }
  }

  async put(name: string, bytes: Uint8Array): Promise<void> {
    const res = await this.request('PUT', joinDavUrl(this.base, name), {
      headers: { 'Content-Type': 'application/gzip' },
      body: bytes as unknown as RequestInit['body'],
    })
    if (![200, 201, 204].includes(res.status)) {
      throw new WebDavError(`上传失败（${res.status}）`, res.status)
    }
  }

  async list(): Promise<WebDavFile[]> {
    const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>`
    const res = await this.request('PROPFIND', this.base, {
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    })
    if (res.status !== 207 && res.status !== 200) {
      throw new WebDavError(`列目录失败（${res.status}）`, res.status)
    }
    const xml = await res.text()
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false })
    const doc = parser.parse(xml) as {
      multistatus?: { response?: Record<string, unknown> | Record<string, unknown>[] }
    }
    const files: WebDavFile[] = []
    for (const node of toArray(doc.multistatus?.response)) {
      const href = String(node.href ?? '')
      if (!href) continue
      const props = propOf(node)
      const isCollection =
        props.resourcetype !== undefined &&
        typeof props.resourcetype === 'object' &&
        props.resourcetype !== null &&
        'collection' in (props.resourcetype as Record<string, unknown>)
      if (isCollection) continue
      let name: string
      try {
        name = decodeURIComponent(href.split('/').filter(Boolean).pop() ?? '')
      } catch {
        name = href.split('/').filter(Boolean).pop() ?? ''
      }
      if (!BACKUP_FILE_PATTERN.test(name)) continue
      const size = Number(props.getcontentlength ?? 0)
      files.push({
        name,
        size: Number.isFinite(size) ? size : 0,
        lastModified: props.getlastmodified ? String(props.getlastmodified) : undefined,
      })
    }
    // 文件名里的时间戳可按字典序排序
    return files.sort((a, b) => b.name.localeCompare(a.name))
  }

  async get(name: string): Promise<Uint8Array> {
    if (!BACKUP_FILE_PATTERN.test(name)) throw new WebDavError('文件名不合法')
    const res = await this.request('GET', joinDavUrl(this.base, name))
    if (res.status !== 200) throw new WebDavError(`下载备份失败（${res.status}）`, res.status)
    return new Uint8Array(await res.arrayBuffer())
  }

  async remove(name: string): Promise<void> {
    if (!BACKUP_FILE_PATTERN.test(name)) throw new WebDavError('文件名不合法')
    const res = await this.request('DELETE', joinDavUrl(this.base, name))
    if (![200, 204, 404].includes(res.status)) {
      throw new WebDavError(`删除旧备份失败（${res.status}）`, res.status)
    }
  }

  /** 连接自检：建目录 + 列目录 */
  async test(): Promise<{ files: number }> {
    await this.ensureDir()
    const list = await this.list()
    return { files: list.length }
  }

  /** 保留策略：只计 youlin-backup-*，恢复前存档不动 */
  async prune(retain: number): Promise<number> {
    const list = await this.list()
    const backups = list.filter((f) => f.name.startsWith(BACKUP_PREFIX))
    const stale = backups.slice(Math.max(0, retain))
    for (const f of stale) await this.remove(f.name)
    return stale.length
  }
}

export function webdavReady(cfg: { backup: { webdavUrl: string; webdavUsername: string } }, password: string | undefined): boolean {
  return Boolean(cfg.backup.webdavUrl.trim() && cfg.backup.webdavUsername.trim() && password)
}

export function webdavClientFor(
  cfg: { backup: { webdavUrl: string; webdavUsername: string; webdavPath: string } },
  password: string | undefined,
  fetchImpl?: typeof fetch,
): WebDavClient {
  if (!webdavReady(cfg, password)) {
    throw new WebDavError('WebDAV 未配置：请在设置页填写地址与用户名，并设置 WEBDAV_PASSWORD')
  }
  return new WebDavClient({
    url: cfg.backup.webdavUrl.trim(),
    username: cfg.backup.webdavUsername.trim(),
    password: password!,
    path: cfg.backup.webdavPath,
    fetchImpl,
  })
}
