import fs from 'node:fs'
import path from 'node:path'
import type { Env } from '../types'

/**
 * Node 侧静态资源：与 wrangler assets 的行为对齐
 *   /api/*、/apply、/healthz → 交给 Hono
 *   命中 web/dist 里的文件 → 直接返回（/assets/ 带哈希，长缓存）
 *   其余 GET → index.html（SPA fallback）
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.gz': 'application/gzip',
}

function isAppPath(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/apply' ||
    pathname.startsWith('/apply/') ||
    pathname === '/healthz' ||
    pathname.startsWith('/healthz/')
  )
}

function safeDecode(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

/** 解析到 web/dist 内的真实文件，越界返回 null */
function resolveInside(root: string, pathname: string): string | null {
  const resolved = path.resolve(root, `.${pathname}`)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

function statFile(file: string): fs.Stats | null {
  try {
    const st = fs.statSync(file)
    return st.isFile() ? st : null
  } catch {
    return null
  }
}

function cacheControl(pathname: string): string {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  if (pathname.endsWith('.html') || pathname === '/') return 'no-cache'
  return 'public, max-age=3600'
}

function fileResponse(file: string, pathname: string, st: fs.Stats, headOnly: boolean, ifNoneMatch: string | null): Response {
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: { ETag: etag } })
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(st.size),
    'Cache-Control': cacheControl(pathname),
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
  }
  if (headOnly) return new Response(null, { headers })
  return new Response(fs.readFileSync(file), { headers })
}

export type FetchFn = (request: Request, env: Env, ctx?: unknown) => Response | Promise<Response>

export function createFetchHandler(root: string, appFetch: FetchFn): FetchFn {
  const rootResolved = path.resolve(root)
  const indexPath = path.join(rootResolved, 'index.html')

  return async (request, env, ctx) => {
    const url = new URL(request.url)
    if (isAppPath(url.pathname)) return appFetch(request, env, ctx)

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const headOnly = request.method === 'HEAD'
    const pathname = safeDecode(url.pathname)
    if (pathname === null) return new Response('Bad Request', { status: 400 })

    if (pathname !== '/') {
      const file = resolveInside(rootResolved, pathname)
      const st = file ? statFile(file) : null
      if (file && st) {
        return fileResponse(file, pathname, st, headOnly, request.headers.get('if-none-match'))
      }
      // 带扩展名的未知文件按 404 处理，不让 SPA 把缺失的静态资源渲染成 HTML
      if (path.extname(pathname) !== '') {
        return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }
    }

    const st = statFile(indexPath)
    if (!st) {
      return new Response('前端构建产物缺失：请先运行 pnpm build（web/dist）', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    return fileResponse(indexPath, '/', st, headOnly, request.headers.get('if-none-match'))
  }
}
