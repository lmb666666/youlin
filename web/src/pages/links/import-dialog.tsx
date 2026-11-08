import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileJson, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'
import { invalidateLinkData } from '@/lib/query'

const MAX_BYTES = 16 * 1024 * 1024

function summarize(value: unknown): { groups: number; friends: number } | null {
  if (Array.isArray(value)) return { groups: 0, friends: value.length }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (Array.isArray(record.groups)) {
    let friends = 0
    for (const group of record.groups) {
      if (!group || typeof group !== 'object') continue
      const entry = group as Record<string, unknown>
      for (const key of ['links', 'friends', 'sites', 'items']) {
        if (Array.isArray(entry[key])) {
          friends += entry[key].length
          break
        }
      }
    }
    return { groups: record.groups.length, friends }
  }
  for (const key of ['friends', 'links', 'sites', 'items']) {
    if (Array.isArray(record[key])) return { groups: 0, friends: record[key].length }
  }
  return null
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<unknown>(null)
  const [preview, setPreview] = useState<{ groups: number; friends: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ imported: number; updated: number; skipped: number; groupsCreated: number; errors: { index: number; message: string }[] } | null>(null)

  function parse(value: string): void {
    setText(value)
    setError(null)
    setResult(null)
    if (!value.trim()) {
      setParsed(null)
      setPreview(null)
      return
    }
    try {
      const data = JSON.parse(value) as unknown
      const summary = summarize(data)
      if (!summary) throw new Error('JSON 结构无法识别：需要条目数组或包含 groups / friends / links 的对象')
      setParsed(data)
      setPreview(summary)
    } catch (err) {
      setParsed(null)
      setPreview(null)
      setError(err instanceof Error ? err.message : 'JSON 解析失败')
    }
  }

  async function readFile(file: File): Promise<void> {
    if (file.size > MAX_BYTES) {
      setError('文件超过 16 MB，请拆分后重试')
      return
    }
    parse(await file.text())
  }

  const mutation = useMutation({
    mutationFn: () => api('/api/admin/import', { method: 'POST', body: JSON.stringify(parsed) }),
    onSuccess: (data) => {
      setResult(data as typeof result)
      invalidateLinkData(client)
    },
    onError: (err) => setError(err instanceof Error ? err.message : '导入失败'),
  })

  function close(next: boolean): void {
    onOpenChange(next)
    if (!next) {
      setError(null)
      setResult(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>导入友链数据</DialogTitle>
          <DialogDescription>
            支持条目数组、带 groups 的对象，或 friends / links / sites 数组。按链接去重，已存在记录会更新。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['新增', result.imported],
                ['更新', result.updated],
                ['跳过', result.skipped],
                ['新建分组', result.groupsCreated],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-secondary/50 px-3 py-2">
                  <p className="text-[11px] text-subtle">{label}</p>
                  <p className="mt-1 font-serif text-2xl tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg border border-warning-border bg-warning-bg p-3">
                <p className="text-xs font-medium text-warning">有 {result.errors.length} 条未导入</p>
                <ul className="mt-2 max-h-32 overflow-y-auto text-[11px] text-muted-foreground">
                  {result.errors.slice(0, 20).map((item) => (
                    <li key={item.index}>第 {item.index + 1} 条：{item.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => close(false)}>完成</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            <div
              className="grid gap-2"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file) void readFile(file)
              }}
            >
              <Textarea
                value={text}
                onChange={(event) => parse(event.target.value)}
                rows={10}
                spellCheck={false}
                className="font-mono text-xs"
                placeholder={'粘贴 JSON，或把 .json 文件拖到这里\n\n[\n  { "author": "Liang", "link": "https://blog.liang.one/" }\n]'}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'import-error' : undefined}
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void readFile(file)
                    event.target.value = ''
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload /> 选择 JSON 文件
                </Button>
                {preview && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-subtle">
                    <FileJson className="size-3.5" />
                    预览：{preview.groups > 0 ? `${preview.groups} 个分组 · ` : ''}{preview.friends} 条友链
                  </span>
                )}
              </div>
            </div>

            {error && (
              <p id="import-error" role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)} disabled={mutation.isPending}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={!parsed || mutation.isPending}
              >
                {mutation.isPending ? '导入中…' : '开始导入'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
