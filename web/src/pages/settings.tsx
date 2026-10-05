import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, RotateCcw, Save, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { api, type SettingsSchemaField, type SettingsSchemaGroup } from '@/lib/api'

type Values = Record<string, unknown>

export default function SettingsPage() {
  const [schema, setSchema] = useState<SettingsSchemaGroup[] | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [dirty, setDirty] = useState<Values>({})
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const s = await api<{ groups: SettingsSchemaGroup[] }>('/api/admin/settings/schema')
      const v = await api<{ values: Values }>('/api/admin/settings')
      setSchema(s.groups)
      setValues(v.values)
      setDirty({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载设置失败')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const dirtyCount = useMemo(() => Object.keys(dirty).length, [dirty])

  function setField(key: string, value: unknown) {
    setValues((v) => (v ? { ...v, [key]: value } : v))
    setDirty((d) => ({ ...d, [key]: value }))
  }

  async function save() {
    if (dirtyCount === 0 || busy) return
    setBusy(true)
    try {
      const res = await api<{ values: Values }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify(dirty) })
      setValues(res.values)
      setDirty({})
      toast.success(`已保存 ${dirtyCount} 项设置`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    void file.text().then(async (t) => {
      try {
        const body = JSON.parse(t) as Values
        await api('/api/admin/settings/import', { method: 'POST', body: JSON.stringify(body) })
        toast.success('配置已导入（整表替换）')
        void reload()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入失败')
      }
    })
    e.target.value = ''
  }

  if (!schema || !values) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">设置</h1>
          <p className="text-sm text-muted-foreground">全部配置都有默认值，开箱即用；改动保存后立即生效。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href="/api/admin/settings/export" download>
              <Download /> 导出
            </a>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <Upload /> 导入
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>导入配置</AlertDialogTitle>
                <AlertDialogDescription>
                  将用导入文件整表替换当前配置。选择 JSON 文件继续。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input type="file" accept=".json,application/json" onChange={onImportFile} />
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button onClick={() => void save()} disabled={dirtyCount === 0 || busy}>
            <Save /> 保存{dirtyCount > 0 ? `（${dirtyCount}）` : ''}
          </Button>
        </div>
      </div>

      {schema.map((group) => (
        <Card key={group.key}>
          <CardHeader>
            <CardTitle className="text-base">{group.label}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {group.fields.map((f) => (
              <FieldControl key={f.key} field={f} value={values[f.key]} dirty={f.key in dirty} onChange={(v) => setField(f.key, v)} />
            ))}
          </CardContent>
        </Card>
      ))}

      <p className="pb-6 text-center text-xs text-muted-foreground">
        <RotateCcw className="mr-1 inline size-3" />
        配置优先级：环境变量 YOULIN_CONFIG_OVERRIDES &gt; 此处设置 &gt; 代码默认值
      </p>
    </div>
  )
}

function FieldControl(props: {
  field: SettingsSchemaField
  value: unknown
  dirty: boolean
  onChange: (value: unknown) => void
}) {
  const { field: f, value, dirty, onChange } = props
  const className = dirty ? 'border-amber-500/60' : undefined

  return (
    <div className={`grid gap-1.5 ${f.full ? 'md:col-span-2' : ''}`}>
      <Label className="text-xs" title={f.key}>
        {f.label} <span className="text-muted-foreground/60">{f.key}</span>
      </Label>
      {f.type === 'boolean' && (
        <div className="flex items-center gap-2 py-1">
          <Switch checked={value === true} onCheckedChange={onChange} />
          <span className="text-sm text-muted-foreground">{value === true ? '开启' : '关闭'}</span>
        </div>
      )}
      {f.type === 'number' && (
        <Input
          type="number"
          className={className}
          value={typeof value === 'number' ? value : ''}
          min={f.min}
          max={f.max}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )}
      {f.type === 'enum' && (
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger className={`w-full ${className ?? ''}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(f.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {f.type === 'stringList' && (
        <Input
          className={className}
          value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
          placeholder="逗号分隔"
          onChange={(e) => onChange(e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean))}
        />
      )}
      {f.type === 'json' && (
        <Textarea
          className={`font-mono text-xs ${className ?? ''}`}
          rows={3}
          value={JSON.stringify(value ?? null)}
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value) as unknown)
            } catch {
              // 输入过程中允许暂态非法 JSON，保存时统一校验
            }
          }}
        />
      )}
      {(f.type === 'string' || f.type === 'text') && (
        f.type === 'text'
          ? <Textarea className={className} rows={2} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
          : <Input className={className} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      <p className="text-xs text-muted-foreground">{f.description}</p>
    </div>
  )
}
