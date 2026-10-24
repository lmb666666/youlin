/**
 * 客户端 IP 判定（登录限流与申请限流共用）：
 *  - Workers：cf-connecting-ip 由 Cloudflare 注入，不可伪造
 *  - Node 直连：socket 远端地址为公网时直接采信，忽略 X-Forwarded-For（防伪造绕过限流）
 *  - Node 带本地反代：socket 是回环/私网 → 取 X-Forwarded-For 最后一段（由可信代理追加的真实地址）
 *  - 其余（无 socket、无 cf 头，如测试环境）：回退 XFF 首段 / 'local'
 */

const PRIVATE_V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** 环回/私网/链路本地地址（含云元数据 169.254.169.254 与 IPv4 映射写法） */
export function isPrivateIp(ip: string): boolean {
  const m = ip.match(PRIVATE_V4)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  const lower = ip.toLowerCase()
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped?.[1]) return isPrivateIp(mapped[1])
  // URL 会把 IPv4 映射地址规范化成十六进制形式（如 ::ffff:7f00:1），取末 32 位还原成 IPv4 再判
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7)
    if (tail.includes('.')) return isPrivateIp(tail.split(':').pop() ?? '')
    const groups = tail.split(':')
    const hi = parseInt(groups[groups.length - 2] ?? '', 16)
    const lo = parseInt(groups[groups.length - 1] ?? '', 16)
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      return isPrivateIp(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
    }
  }
  if (lower === '::' || lower === '::1') return true
  // IPv6 唯一本地 fc00::/7 与链路本地 fe80::/10
  return /^(f[cd]|fe[89ab])/i.test(lower)
}

export function isPublicIp(ip: string): boolean {
  return !isPrivateIp(ip)
}

function xffParts(xff: string | undefined): string[] {
  return (xff ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

/** @hono/node-server 把 incoming/outgoing 放进 env；Workers 的 env 是资源绑定，没有 incoming */
function nodeRemoteAddress(env: unknown): string | null {
  const incoming = (env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined)?.incoming
  const addr = incoming?.socket?.remoteAddress
  return typeof addr === 'string' && addr !== '' ? addr : null
}

export function clientIp(c: { req: { header: (k: string) => string | undefined }; env: unknown }): string {
  const cf = c.req.header('cf-connecting-ip')
  if (cf) return cf
  const socket = nodeRemoteAddress(c.env)
  const xff = xffParts(c.req.header('x-forwarded-for'))
  if (socket === null) return xff[0] ?? 'local'
  if (!isPublicIp(socket)) return xff[xff.length - 1] ?? socket
  return socket
}
