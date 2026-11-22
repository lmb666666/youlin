/**
 * link 的等价写法：尾斜杠、主机名大小写、http 默认端口的差异都不应绕过去重。
 * 无法解析的输入退回仅尾斜杠的口径。
 */
export function linkVariants(link: string): string[] {
  const out = new Set<string>([link])
  const noSlashRaw = link.replace(/\/+$/, '')
  out.add(noSlashRaw)
  out.add(noSlashRaw + '/')
  try {
    const u = new URL(link)
    u.hostname = u.hostname.toLowerCase()
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = ''
    }
    const normalized = u.toString()
    const noSlash = normalized.replace(/\/+$/, '')
    out.add(normalized)
    out.add(noSlash)
    out.add(noSlash + '/')
  } catch {
    /* 非法 URL 只保留原始写法的变体 */
  }
  return [...out]
}
