import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowUpRight, Braces, Check, Copy, ExternalLink, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          toast.success(label ?? '已复制')
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('复制失败，请手动选择复制')
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? '已复制' : '复制'}
    </Button>
  )
}

function Endpoint(props: {
  method: 'GET' | 'POST'
  path: string
  desc: string
  params?: { name: string; desc: string }[]
  code?: string
  openHref?: string
  openLabel?: string
}) {
  const { method, path, desc, params, code, openHref, openLabel } = props
  const origin = window.location.origin
  const url = origin + path
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Badge variant={method === 'GET' ? 'secondary' : 'default'} className="font-mono text-xs">{method}</Badge>
          <code className="text-sm">{path}</code>
          <span className="ml-auto"><CopyButton text={url} label="接口地址已复制" /></span>
        </CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2 overflow-x-auto rounded-md bg-muted/60 px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-xs" title={url}>{url}</code>
        </div>
        {params && params.length > 0 && (
          <ul className="grid gap-1 text-sm text-muted-foreground">
            {params.map((p) => (
              <li key={p.name}>
                <code className="text-foreground">{p.name}</code> — {p.desc}
              </li>
            ))}
          </ul>
        )}
        {code && (
          <div className="relative">
            <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-xs leading-relaxed"><code>{code}</code></pre>
            <div className="absolute right-1.5 top-1.5"><CopyButton text={code} label="示例已复制" /></div>
          </div>
        )}
        {openHref && (
          <Button variant="outline" size="sm" className="w-fit" asChild>
            <a href={openHref} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> {openLabel}
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function IntegrationPage() {
  const [cfg, setCfg] = useState<{ cacheSeconds: number; corsOrigin: string } | null>(null)
  const origin = window.location.origin

  const reload = useCallback(async () => {
    try {
      const { values } = await api<{ values: Record<string, unknown> }>('/api/admin/settings')
      setCfg({
        cacheSeconds: typeof values['api.cacheSeconds'] === 'number' ? values['api.cacheSeconds'] : 300,
        corsOrigin: typeof values['api.corsOrigin'] === 'string' ? values['api.corsOrigin'] : '*',
      })
    } catch {
      setCfg({ cacheSeconds: 300, corsOrigin: '*' })
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const linksSample = `const res = await fetch('${origin}/api/links')
const { groups } = await res.json()
for (const g of groups) {
  for (const link of g.links) {
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
    turnstileToken: token, // 申请页 Turnstile 挂件返回的 token
  }),
})
const data = await res.json()
// 201: { id, status, backlink: { ok, detail } }
// 400/403/409/429: { error: { code, message, details } }`

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 [&>*]:min-w-0">
      <div>
        <h1 className="text-lg font-semibold">接入</h1>
        <p className="text-sm text-muted-foreground">
          三个对外接口的地址与示例，可直接复制使用。
        </p>
      </div>

      {!cfg ? (
        <div className="grid gap-4"><Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 py-4 text-sm text-muted-foreground">
              <span>缓存：<code className="text-foreground">max-age={cfg.cacheSeconds}</code></span>
              <span>CORS：<code className="text-foreground">{cfg.corsOrigin}</code></span>
              <span>时间：ISO 8601 UTC</span>
              <span className="ml-auto">
                <a href="https://github.com/lmb666666/youlin/blob/main/docs/api.md" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                  完整接口文档 <ArrowUpRight className="size-3.5" />
                </a>
              </span>
            </CardContent>
          </Card>

          <Endpoint
            method="GET"
            path="/api/links"
            desc="友链分组数据，每条含体检摘要 health。推荐在博客页面运行时获取。"
            params={[
              { name: '?group=分组名', desc: '按分组名精确过滤（URL 编码）' },
            ]}
            code={linksSample}
          />

          <Endpoint
            method="GET"
            path="/api/circle"
            desc="朋友圈文章聚合与统计。"
            params={[
              { name: '?limit=N', desc: '截断文章条数（默认与上限见设置）' },
            ]}
            code={circleSample}
          />

          <Endpoint
            method="POST"
            path="/apply"
            desc="提交友链申请；申请页可直接外链给访客。"
            params={[
              { name: 'siteName / link', desc: '必填（站点名与站点链接）' },
              { name: 'author / avatar / feed / desc / contact / note', desc: '选填' },
              { name: 'turnstileToken', desc: '启用人机验证时必填' },
            ]}
            code={applySample}
            openHref={`${origin}/apply`}
            openLabel="打开申请页"
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Braces className="size-4" /> 接入检查清单
              </CardTitle>
              <CardDescription>上线前建议逐项确认。</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> 浏览器直接打开数据接口，返回正常 JSON</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> 页面 fetch 无跨域报错</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> 接口请求加超时与降级，异常时不白屏</li>
                <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> 管理台改动后刷新可见（缓存最长 {cfg.cacheSeconds} 秒）</li>
              </ul>
            </CardContent>
          </Card>

          <p className="pb-4 text-center text-xs text-muted-foreground">
            <Send className="mr-1 inline size-3" />
            「申请友链」按钮指向：{origin}/apply
          </p>
        </>
      )}
    </div>
  )
}
