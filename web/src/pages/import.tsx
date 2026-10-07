import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileUp, Import } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { api, type ImportResult } from '@/lib/api'

export default function ImportPage() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function submit() {
    if (!text.trim() || busy) return
    setBusy(true)
    setResult(null)
    try {
      const body = JSON.parse(text) as unknown
      const res = await api<ImportResult>('/api/admin/import', { method: 'POST', body: JSON.stringify(body) })
      setResult(res)
      toast.success(`导入完成：新增 ${res.imported}，更新 ${res.updated}${res.skipped > 0 ? `，跳过 ${res.skipped}` : ''}`)
    } catch (err) {
      if (err instanceof SyntaxError) {
        toast.error('JSON 解析失败：' + err.message)
      } else {
        toast.error(err instanceof Error ? err.message : '导入失败')
      }
    } finally {
      setBusy(false)
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((t) => {
      setText(t)
      toast.info(`已读取 ${file.name}`)
    })
    e.target.value = ''
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 [&>*]:min-w-0">
      <div>
        <h1 className="text-lg font-semibold">批量导入</h1>
        <p className="text-sm text-muted-foreground">
          粘贴或上传 JSON，按链接去重，可重复执行。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">数据来源</CardTitle>
          <CardDescription>支持条目数组、分组结构和常见字段别名（url / rss / img …）。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={'[\n  { "author": "Liang", "link": "https://blog.example.com/", "feed": "https://blog.example.com/atom.xml", "since": "2024-08-25" },\n  { "author": "Aki", "url": "https://aki.example.com/", "group": "技术区" }\n]'}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button onClick={() => void submit()} disabled={busy || !text.trim()}>
              <Import /> {busy ? '导入中…' : '开始导入'}
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <FileUp /> 选择 JSON 文件
            </Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">导入结果</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div className="flex gap-4">
              <span>新增 <b>{result.imported}</b></span>
              <span>更新 <b>{result.updated}</b></span>
              <span>跳过 <b>{result.skipped}</b></span>
              <span>新建分组 <b>{result.groupsCreated}</b></span>
            </div>
            {result.errors.length > 0 && (
              <ul className="grid gap-1 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {result.errors.map((e, i) => (
                  <li key={i}>第 {e.index + 1} 条：{e.message}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
