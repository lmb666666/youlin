import { ArrowUpRight, Braces, Check, ExternalLink, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CopyButton } from '@/components/common/copy-button'
import { PageHeader } from '@/components/common/page-header'
import { StatusBadge } from '@/components/common/status-badge'
import { useSettings } from '@/lib/settings'

function Endpoint({
  method,
  path,
  desc,
  params,
  code,
  openHref,
  openLabel,
}: {
  method: 'GET' | 'POST'
  path: string
  desc: string
  params?: { name: string; desc: string }[]
  code?: string
  openHref?: string
  openLabel?: string
}) {
  const url = window.location.origin + path
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <StatusBadge tone={method === 'GET' ? 'info' : 'success'}>{method}</StatusBadge>
          <code className="font-mono text-sm">{path}</code>
          <span className="ml-auto"><CopyButton value={url} label="复制地址" /></span>
        </CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3 pt-4">
        <div className="flex items-center gap-2 rounded-lg border bg-secondary/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{url}</code>
          <CopyButton value={url} iconOnly />
        </div>
        {params && params.length > 0 && (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {params.map((param) => (
              <li key={param.name}>
                <code className="text-foreground">{param.name}</code> — {param.desc}
              </li>
            ))}
          </ul>
        )}
        {code && (
          <div className="relative min-w-0">
            <pre className="max-w-full overflow-x-auto rounded-lg border bg-secondary/40 p-3 font-mono text-[11px] leading-relaxed"><code>{code}</code></pre>
            <div className="absolute top-1.5 right-1.5"><CopyButton value={code} iconOnly /></div>
          </div>
        )}
        {openHref && (
          <Button variant="outline" size="sm" className="w-fit" asChild>
            <a href={openHref} target="_blank" rel="noreferrer">
              <ExternalLink /> {openLabel}
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function IntegrationPage() {
  const settings = useSettings()
  const origin = window.location.origin
  const cacheSeconds = typeof settings['api.cacheSeconds'] === 'number' ? settings['api.cacheSeconds'] : 300
  const corsOrigin = typeof settings['api.corsOrigin'] === 'string' ? settings['api.corsOrigin'] : '*'

  const linksSample = `const res = await fetch('${origin}/api/links')
const { groups } = await res.json()
for (const group of groups) {
  for (const link of group.links) {
    // link.author / link.link / link.avatar / link.health …
  }
}`

  const circleSample = `const res = await fetch('${origin}/api/circle?limit=20')
const { stats, articles } = await res.json()
// stats: 友链数 / 活跃数 / 失败数 / 文章总数
// articles: 按 publishedAt 倒序的文章列表`

  const applySample = `const res = await fetch('${origin}/apply', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    siteName: '我的博客',
    link: 'https://example.com/',
    turnstileToken: token,
  }),
})
const data = await res.json()
// 201: { id, status, backlink: { ok, detail } }
// 400/403/409/429: { error: { code, message, details } }`

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-5">
      <PageHeader
        eyebrow="对外接口 · 三条路径"
        title="接入"
        description="友链数据、朋友圈与友链申请的真实地址与示例，可直接复制。"
      />

      <Card className="py-0">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
          <span>缓存：<code className="text-foreground">max-age={cacheSeconds}</code></span>
          <span>CORS：<code className="text-foreground">{corsOrigin}</code></span>
          <span>时间：ISO 8601 UTC</span>
          <span className="ml-auto">
            <a
              href="https://github.com/lmb666666/youlin/blob/main/docs/api.md"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              完整接口文档 <ArrowUpRight className="size-3.5" />
            </a>
          </span>
        </CardContent>
      </Card>

      <Endpoint
        method="GET"
        path="/api/links"
        desc="友链分组数据，含各站点的健康状态。"
        params={[{ name: '?group=分组名', desc: '按分组名精确过滤（URL 编码）' }]}
        code={linksSample}
      />

      <Endpoint
        method="GET"
        path="/api/circle"
        desc="朋友们最新文章的聚合与统计。"
        params={[{ name: '?limit=N', desc: '截断文章条数（默认与上限见设置）' }]}
        code={circleSample}
      />

      <Endpoint
        method="POST"
        path="/apply"
        desc="提交友链申请，或把申请页直接外链给访客。"
        params={[
          { name: 'siteName / link', desc: '必填（站点名与站点链接）' },
          { name: 'author / avatar / feed / desc / contact / note', desc: '选填' },
          { name: 'turnstileToken', desc: '启用人机验证时必填' },
        ]}
        code={applySample}
        openHref={`${origin}/apply`}
        openLabel="打开申请页"
      />

      <Card className="gap-0 py-0">
        <CardHeader className="border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Braces className="size-4 text-primary" /> 接入检查清单
          </CardTitle>
          <CardDescription>上线前建议逐项确认。</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <ul className="grid gap-2 text-xs text-muted-foreground">
            {[
              '浏览器直接打开数据接口，返回正常 JSON',
              '页面 fetch 无跨域报错',
              '接口请求加超时与降级，异常时不白屏',
              `管理台改动后刷新可见（缓存最长 ${cacheSeconds} 秒）`,
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="flex items-center justify-center gap-1.5 pb-4 text-center text-[11px] text-subtle">
        <Send className="size-3" />
        「申请友链」按钮指向：{origin}/apply
      </p>
    </div>
  )
}
