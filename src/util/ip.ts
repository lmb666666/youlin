/**
 * 客户端 IP 判定（登录限流与申请限流共用）：
 *  - 直连：socket 远端地址为公网时直接采信，忽略 X-Forwarded-For（防伪造绕过限流）
 *  - 带本地反代：socket 是回环/私网 → 取 X-Forwarded-For 最后一段（由可信代理追加的真实地址）
 *  - 无 socket（测试环境）：回退 XFF 最后一段 / 'local'
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

export function isLoopbackIp(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (/^127\./.test(ip)) return true
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped?.[1]) return isLoopbackIp(mapped[1])
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7)
    if (tail.includes('.')) return isLoopbackIp(tail.split(':').pop() ?? '')
    const groups = tail.split(':')
    const hi = parseInt(groups[groups.length - 2] ?? '', 16)
    const lo = parseInt(groups[groups.length - 1] ?? '', 16)
    if (Number.isFinite(hi) && Number.isFinite(lo)) return hi >> 8 === 0x7f && (hi & 0xff) === 0
  }
  return false
}

function xffParts(xff: string | undefined): string[] {
  return (xff ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

/** @hono/node-server 把 incoming/outgoing 放进 env */
function nodeRemoteAddress(env: unknown): string | null {
  const incoming = (env as { incoming?: { socket?: { remoteAddress?: unknown } } } | undefined)?.incoming
  const addr = incoming?.socket?.remoteAddress
  return typeof addr === 'string' && addr !== '' ? addr : null
}

export function clientIp(c: { req: { header: (k: string) => string | undefined }; env: unknown }): string {
  const socket = nodeRemoteAddress(c.env)
  const xff = xffParts(c.req.header('x-forwarded-for'))

  // 无 socket（测试/嵌入式调用）时只能依赖 XFF 最后一档
  if (socket === null) return xff[xff.length - 1] ?? 'local'
  if (isPublicIp(socket)) return socket

  // 私网 peer 可能是反代，也可能是 Docker 端口发布/局域网直连。只有显式信任时才采信 XFF。
  const mode = (c.env as { TRUST_PROXY?: unknown } | undefined)?.TRUST_PROXY
  if (mode === 'private' || (mode === 'loopback' && isLoopbackIp(socket))) {
    return xff[xff.length - 1] ?? socket
  }
  return socket
}
