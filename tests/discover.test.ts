import { describe, it, expect } from 'vitest'
import { extractDeclaredFeeds, commonFeedPaths, toAbsolute } from '../src/crawler/discover'

describe('feed 发现', () => {
  it('extractDeclaredFeeds 识别 rss+xml / atom+xml / xml，忽略非 feed 的 alternate', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed.xml">
        <link rel="alternate" type="application/atom+xml" title="Atom" href="https://other.example.com/atom.xml">
        <link rel="alternate" type="text/xml" href="/index.xml">
        <link rel="alternate" type="text/html" hreflang="en" href="/en/">
        <link rel="stylesheet" href="/style.css">
        <link rel="alternate" type="application/feed+json" href="/feed.json">
      </head></html>`
    const found = extractDeclaredFeeds(html, 'https://blog.example.com/')
    expect(found).toContain('https://blog.example.com/feed.xml')
    expect(found).toContain('https://other.example.com/atom.xml')
    expect(found).toContain('https://blog.example.com/index.xml')
    expect(found).toContain('https://blog.example.com/feed.json')
    expect(found).not.toContain('https://blog.example.com/en/')
    expect(found).not.toContain('https://blog.example.com/style.css')
  })

  it('extractDeclaredFeeds 兼容单引号/大写/属性顺序变化', () => {
    const html = `<link HREF='/rss.xml' TYPE="Application/RSS+XML" REL='alternate'>`
    expect(extractDeclaredFeeds(html, 'https://x.example.com/')).toEqual(['https://x.example.com/rss.xml'])
  })

  it('commonFeedPaths 覆盖常见路径且基于站点根', () => {
    const paths = commonFeedPaths('https://blog.example.com/')
    expect(paths[0]).toBe('https://blog.example.com/feed')
    expect(paths).toContain('https://blog.example.com/atom.xml')
    expect(paths).toContain('https://blog.example.com/rss.xml')
    expect(commonFeedPaths('https://blog.example.com')).toContain('https://blog.example.com/feed.xml')
  })

  it('toAbsolute：相对/绝对/非法', () => {
    expect(toAbsolute('/a.xml', 'https://x.example.com/blog/')).toBe('https://x.example.com/a.xml')
    expect(toAbsolute('a.xml', 'https://x.example.com/blog/')).toBe('https://x.example.com/blog/a.xml')
    expect(toAbsolute('https://y.example.com/f', 'https://x.example.com/')).toBe('https://y.example.com/f')
    expect(toAbsolute('http://[bad', 'https://x.example.com/')).toBeNull()
  })
})
