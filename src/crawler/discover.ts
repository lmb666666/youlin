/** feed 发现：HTML <link rel="alternate"> + 常见路径（probe 端点与体检回退共用，DESIGN §5/§6） */

const FEED_TYPES = /application\/(?:rss|atom)\+xml|application\/feed\+json|(?:application|text)\/xml/i

/** 从 HTML 中提取声明的 feed 候选（相对地址解析为绝对） */
export function extractDeclaredFeeds(html: string, baseUrl: string): string[] {
  const out: string[] = []
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of linkTags) {
    if (!/\brel\s*=\s*["']?alternate/i.test(tag)) continue
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? ''
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href || !FEED_TYPES.test(type)) continue
    const abs = toAbsolute(href, baseUrl)
    if (abs) out.push(abs)
  }
  return out
}

/** 常见 feed 路径（借鉴 FCL 的探测清单） */
export function commonFeedPaths(siteUrl: string): string[] {
  const base = siteUrl.replace(/\/+$/, '')
  return [
    `${base}/feed`,
    `${base}/feed.xml`,
    `${base}/rss.xml`,
    `${base}/atom.xml`,
    `${base}/rss`,
    `${base}/index.xml`,
    `${base}/feed.atom`,
    `${base}/?feed=rss2`,
  ]
}

export function toAbsolute(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return null
  }
}
