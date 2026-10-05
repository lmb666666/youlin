// 本地 mock RSS 源：验收抓取链路用（node scripts/mock-source.mjs [port]）
// 两个源：/feed-a（带 ETag，支持条件请求）、/feed-b（无 ETag）；每次启动内容固定。
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8788)
const etag = '"mock-etag-1"'

const feedA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Mock A</title>
  ${[1, 2, 3, 4, 5, 6, 7]
    .map(
      (i) =>
        `<item><title>A 第 ${i} 篇</title><link>https://mock-a.example.com/post/${i}</link><guid>a-${i}</guid><pubDate>${new Date(Date.now() - i * 86_400_000).toUTCString()}</pubDate></item>`,
    )
    .join('\n  ')}
</channel></rss>`

const feedB = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Mock B</title>
  <item><title>B 唯一一篇</title><link>https://mock-b.example.com/post/1</link><guid>b-1</guid><pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate></item>
</channel></rss>`

let hits = 0

createServer((req, res) => {
  hits++
  const url = req.url ?? '/'
  console.log(`[${new Date().toISOString()}] #${hits} ${req.method} ${url}`)
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith('if-')) console.log(`    ${k}: ${v}`)
  }
  if (req.headers['if-none-match'] === etag && url === '/feed-a') {
    res.writeHead(304, { ETag: etag })
    res.end()
    return
  }
  if (url === '/feed-a') {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', ETag: etag })
    res.end(feedA)
  } else if (url === '/feed-b') {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' })
    res.end(feedB)
  } else if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><head><title>Mock 站点</title><link rel="alternate" type="application/rss+xml" href="/feed-a"></head><body><a href="https://friend-site.example.com/">我朋友</a></body></html>')
  } else {
    res.writeHead(404)
    res.end('not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`mock RSS source on http://127.0.0.1:${port}/feed-a, /feed-b`))
