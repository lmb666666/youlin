import { describe, it, expect } from 'vitest'
import { parseFeed, withResolvedGuids } from '../src/crawler/parse'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>示例博客</title>
    <item>
      <title>第一篇</title>
      <link>https://a.example.com/1</link>
      <guid isPermaLink="false">guid-1</guid>
      <pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate>
      <dc:creator>作者甲</dc:creator>
    </item>
    <item>
      <title>没有日期的会被丢</title>
      <link>https://a.example.com/2</link>
    </item>
    <item>
      <title>只有 updated（dc:date 缺失时用不上但 pubDate 缺失）</title>
      <link>https://a.example.com/3</link>
      <dc:date>2026-10-04T08:30:00+08:00</dc:date>
    </item>
    <item>
      <title>坏条目：没有链接</title>
      <pubDate>Mon, 05 Oct 2026 09:00:00 GMT</pubDate>
    </item>
    <item>
      <title>无 guid 用 link 哈希</title>
      <link>https://a.example.com/5</link>
      <pubDate>Sat, 03 Oct 2026 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom 博客</title>
  <entry>
    <title>Atom 文章</title>
    <link rel="alternate" type="text/html" href="https://b.example.com/atom-1"/>
    <link rel="self" href="https://b.example.com/atom-1.json"/>
    <id>urn:uuid:aaa-bbb</id>
    <published>2026-10-01T10:00:00Z</published>
    <updated>2026-10-02T10:00:00Z</updated>
    <author><name>作者乙</name></author>
  </entry>
  <entry>
    <title>无 published 用 updated</title>
    <link href="https://b.example.com/atom-2"/>
    <id>id-2</id>
    <updated>2026-10-03T10:00:00Z</updated>
  </entry>
  <entry>
    <title>缺 link 丢弃</title>
    <id>id-3</id>
    <published>2026-10-03T10:00:00Z</published>
  </entry>
</feed>`

describe('feed 解析', () => {
  it('RSS 2.0：published 优先、坏条目跳过、时区归一、dc:creator', async () => {
    const feed = await parseFeed(RSS)
    expect(feed.title).toBe('示例博客')
    expect(feed.entries).toHaveLength(3) // 无日期、无链接的条目被丢弃

    const first = feed.entries[0]!
    expect(first.title).toBe('第一篇')
    expect(first.guid).toBe('guid-1')
    expect(first.publishedAt).toBe('2026-10-05T12:00:00Z')
    expect(first.author).toBe('作者甲')

    const second = feed.entries[1]!
    expect(second.publishedAt).toBe('2026-10-04T00:30:00Z') // +08:00 → UTC
  })

  it('RSS 无 guid → link 的 sha1 兜底', async () => {
    const entries = await withResolvedGuids(await parseFeed(RSS))
    const noGuid = entries.find((e) => e.link === 'https://a.example.com/5')!
    expect(noGuid.guid).toMatch(/^[0-9a-f]{40}$/)
  })

  it('Atom：alternate link 优先、published 优先于 updated、author.name', async () => {
    const feed = await parseFeed(ATOM)
    expect(feed.title).toBe('Atom 博客')
    expect(feed.entries).toHaveLength(2)

    const first = feed.entries[0]!
    expect(first.link).toBe('https://b.example.com/atom-1') // 不是 self link
    expect(first.publishedAt).toBe('2026-10-01T10:00:00Z') // published 而非 updated
    expect(first.guid).toBe('urn:uuid:aaa-bbb')
    expect(first.author).toBe('作者乙')

    const second = feed.entries[1]!
    expect(second.publishedAt).toBe('2026-10-03T10:00:00Z')
    expect(second.author).toBeNull()
  })

  it('坏 XML / 非 feed 内容抛错', async () => {
    await expect(parseFeed('<rss><channel>')).rejects.toThrow()
    await expect(parseFeed('<html><body>不是 feed</body></html>')).rejects.toThrow('unknown_feed_format')
  })
})
