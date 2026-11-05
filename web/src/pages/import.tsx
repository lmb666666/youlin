import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { FileUp, Import } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { api, type ImportResult } from '@/lib/api'
import { queryKeys } from '@/lib/query'

const importFormSchema = z.object({
  json: z.string().trim().min(1, '请粘贴或选择 JSON'),
})
type ImportFormValues = z.infer<typeof importFormSchema>

export default function ImportPage() {
  const client = useQueryClient()
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const form = useForm<ImportFormValues>({
    resolver: zodResolver(importFormSchema),
    defaultValues: { json: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: ImportFormValues) => {
      const body = JSON.parse(values.json) as unknown
      return api<ImportResult>('/api/admin/import', { method: 'POST', body: JSON.stringify(body) })
    },
    onMutate: () => setResult(null),
    onSuccess: (res) => {
      setResult(res)
      toast.success(`导入完成：新增 ${res.imported}，更新 ${res.updated}${res.skipped > 0 ? `，跳过 ${res.skipped}` : ''}`)
      void client.invalidateQueries({ queryKey: queryKeys.groups })
      void client.invalidateQueries({ queryKey: queryKeys.friends })
      void client.invalidateQueries({ queryKey: queryKeys.stats })
    },
    onError: (err) => {
      if (err instanceof SyntaxError) toast.error('JSON 解析失败：' + err.message)
      else toast.error(err instanceof Error ? err.message : '导入失败')
    },
  })

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then((t) => {
      form.setValue('json', t, { shouldValidate: true })
      toast.info(`已读取 ${file.name}`)
    })
    e.target.value = ''
  }

  const text = form.watch('json')

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
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-3">
            <Textarea
              {...form.register('json')}
              rows={12}
              placeholder={'[\n  { "author": "Liang", "link": "https://blog.example.com/", "feed": "https://blog.example.com/atom.xml", "since": "2024-08-25" },\n  { "author": "Aki", "url": "https://aki.example.com/", "group": "技术区" }\n]'}
              className="font-mono text-xs"
            />
            {form.formState.errors.json && <p className="text-xs text-destructive">{form.formState.errors.json.message}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={mutation.isPending || !text.trim()}>
                <Import /> {mutation.isPending ? '导入中…' : '开始导入'}
              </Button>
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp /> 选择 JSON 文件
              </Button>
              <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
            </div>
          </form>
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
