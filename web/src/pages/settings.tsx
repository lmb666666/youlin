import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, RotateCcw, Save, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { SettingsSchemaField, SettingsSchemaGroup, SettingsValues } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/common/form-field'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState } from '@/components/common/page-state'
import { SaveBar } from '@/components/common/save-bar'
import { SearchField } from '@/components/common/search-field'
import { api, apiDownload } from '@/lib/api'
import { useSettingsQuery, useSettingsSchemaQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query'
import { useBeforeUnload } from '@/lib/dirty'
import { downloadBlob } from '@/lib/download'
import { useQueryParam } from '@/lib/url-state'
import { cn } from '@/lib/utils'

type Values = Record<string, unknown>

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function StringListInput({
  value,
  onChange,
  id,
  placeholder,
}: {
  value: unknown
  onChange: (value: unknown) => void
  id: string
  placeholder?: string
}) {
  const joined = Array.isArray(value) ? (value as string[]).join(', ') : ''
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      id={id}
      value={draft ?? joined}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft === null) return
        setDraft(null)
        onChange(draft.split(/[,，]/).map((item) => item.trim()).filter(Boolean))
      }}
    />
  )
}

function JsonEditor({
  id,
  value,
  onChange,
  onInvalidChange,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  onInvalidChange: (invalid: boolean) => void
}) {
  const [raw, setRaw] = useState<string | null>(null)
  const invalid = raw !== null && !jsonParses(raw)
  return (
    <div className="grid gap-1">
      <Textarea
        id={id}
        value={raw ?? JSON.stringify(value ?? null, null, 2)}
        rows={4}
        spellCheck={false}
        className="max-h-40 overflow-y-auto font-mono text-xs"
        aria-invalid={invalid}
        onChange={(event) => {
          const text = event.target.value
          setRaw(text)
          const valid = jsonParses(text)
          onInvalidChange(!valid)
          if (valid) onChange(JSON.parse(text) as unknown)
        }}
        onBlur={() => {
          if (raw !== null && jsonParses(raw)) {
            setRaw(null)
            onInvalidChange(false)
          }
        }}
      />
      {invalid && <p role="alert" className="text-[11px] text-danger">JSON 格式不正确，修正后才能保存</p>}
    </div>
  )
}

function jsonParses(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function FieldControl({
  field,
  value,
  dirty,
  onChange,
  onInvalidChange,
}: {
  field: SettingsSchemaField
  value: unknown
  dirty: boolean
  onChange: (value: unknown) => void
  onInvalidChange: (invalid: boolean) => void
}) {
  const id = `setting-${field.key.replace(/\./g, '-')}`

  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5 sm:col-span-2">
        <div className="min-w-0">
          <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {field.label}
            {dirty && (
              <span className="rounded-full border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[9px] font-normal text-warning">
                未保存
              </span>
            )}
          </Label>
          <p className="mt-1 text-[11px] leading-relaxed text-subtle">{field.description}</p>
        </div>
        <Switch id={id} checked={value === true} onCheckedChange={onChange} aria-label={field.label} />
      </div>
    )
  }

  return (
    <FormField
      id={id}
      label={field.label}
      hint={field.description}
      dirty={dirty}
      wide={field.full}
    >
      {field.type === 'number' && (
        <Input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={field.min}
          max={field.max}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      )}
      {field.type === 'enum' && (
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {field.type === 'stringList' && (
        <StringListInput id={id} value={value} onChange={onChange} placeholder="逗号分隔" />
      )}
      {field.type === 'json' && (
        <JsonEditor id={id} value={value} onChange={onChange} onInvalidChange={onInvalidChange} />
      )}
      {(field.type === 'string' || field.type === 'text') && (
        field.type === 'text' ? (
          <Textarea
            id={id}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            rows={3}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            id={id}
            value={String(value ?? '')}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      )}
    </FormField>
  )
}

export default function SettingsPage() {
  const client = useQueryClient()
  const schemaQuery = useSettingsSchemaQuery()
  const settingsQuery = useSettingsQuery()
  const [draft, setDraft] = useState<Values>({})
  const [invalidKeys, setInvalidKeys] = useState<Set<string>>(new Set())
  const [formVersion, setFormVersion] = useState(0)
  const [filter, setFilter] = useState('')
  const [section, setSection] = useQueryParam('section', 'site')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const serverValues = useMemo<SettingsValues>(() => settingsQuery.data?.values ?? {}, [settingsQuery.data])
  const values = useMemo(() => ({ ...serverValues, ...draft }), [serverValues, draft])
  const dirtyKeys = Object.keys(draft)

  useBeforeUnload(dirtyKeys.length > 0)

  const setField = (key: string, value: unknown) => {
    // 数字输入清空时不要让 undefined 进入草稿：JSON.stringify 会丢键，服务端收不到
    if (value === undefined) return
    setDraft((previous) => {
      const next = { ...previous }
      if (same(value, serverValues[key])) delete next[key]
      else next[key] = value
      return next
    })
  }

  const markInvalid = (key: string, invalid: boolean) => {
    setInvalidKeys((previous) => {
      const next = new Set(previous)
      if (invalid) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const resetFieldDrafts = () => setFormVersion((version) => version + 1)

  const resetSection = (group: SettingsSchemaGroup) => {
    setDraft((previous) => {
      const next = { ...previous }
      for (const field of group.fields) {
        if (same(field.default, serverValues[field.key])) delete next[field.key]
        else next[field.key] = field.default
      }
      return next
    })
    setInvalidKeys((previous) => {
      const next = new Set(previous)
      for (const field of group.fields) next.delete(field.key)
      return next
    })
    resetFieldDrafts()
  }

  const save = useMutation({
    mutationFn: () => api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(draft) }),
    onSuccess: async () => {
      setDraft({})
      setInvalidKeys(new Set())
      resetFieldDrafts()
      await client.invalidateQueries({ queryKey: queryKeys.settings })
      toast.success('设置已保存')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '保存失败'),
  })

  const exportSettings = useMutation({
    mutationFn: () => apiDownload('/api/admin/settings/export'),
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename ?? 'youlin-settings.json')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : '导出失败'),
  })

  const importSettings = useMutation({
    mutationFn: () => api('/api/admin/settings/import', { method: 'POST', body: importText }),
    onSuccess: async () => {
      setDraft({})
      setInvalidKeys(new Set())
      resetFieldDrafts()
      setImportOpen(false)
      setImportText('')
      setImportError(null)
      await client.invalidateQueries({ queryKey: queryKeys.settings })
      toast.success('配置已导入（整表替换）')
    },
    onError: (error) => setImportError(error instanceof Error ? error.message : '导入失败'),
  })

  const initializedSection = useRef(false)
  useEffect(() => {
    if (initializedSection.current) return
    if (schemaQuery.isPending || settingsQuery.isPending) return
    initializedSection.current = true
    const first = schemaQuery.data?.groups[0]?.key
    if (section && section !== first) {
      document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [section, schemaQuery.isPending, settingsQuery.isPending, schemaQuery.data])

  const scrollToSection = (key: string) => {
    setSection(key)
    window.requestAnimationFrame(() => {
      document.getElementById(`section-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  if (schemaQuery.isError || settingsQuery.isError) {
    return (
      <div className="grid min-w-0 gap-5">
        <PageHeader title="设置" description="所有配置都有默认值，保存后立即生效。" />
        <ErrorState
          title="设置加载失败"
          error={schemaQuery.error ?? settingsQuery.error}
          onRetry={() => {
            void schemaQuery.refetch()
            void settingsQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (schemaQuery.isPending || settingsQuery.isPending || !schemaQuery.data) {
    return (
      <div className="grid gap-5">
        <PageHeader title="设置" description="所有配置都有默认值，保存后立即生效。" />
        <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
          <Skeleton className="h-48 rounded-xl" />
          <div className="grid gap-4">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  const normalized = filter.trim().toLowerCase()
  const groups = schemaQuery.data.groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) =>
        !normalized || `${field.key} ${field.label} ${field.description}`.toLowerCase().includes(normalized),
      ),
    }))
    .filter((group) => group.fields.length > 0)

  const parsedKeys = (() => {
    if (!importText.trim()) return null
    try {
      const value = JSON.parse(importText) as unknown
      return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).length : null
    } catch {
      return null
    }
  })()

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="配置版本 1 · 保存后立即生效"
        title="设置"
        description="所有配置都有默认值，只需要改想改的。"
        actions={
          <>
            <Button variant="outline" onClick={() => exportSettings.mutate()} disabled={exportSettings.isPending}>
              <Download /> {exportSettings.isPending ? '导出中…' : '导出'}
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload /> 导入
            </Button>
            <Button onClick={() => save.mutate()} disabled={dirtyKeys.length === 0 || invalidKeys.size > 0 || save.isPending}>
              <Save /> {save.isPending ? '保存中…' : dirtyKeys.length > 0 ? `保存 ${dirtyKeys.length} 项` : '保存'}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchField
          value={filter}
          onChange={setFilter}
          placeholder="搜索配置项"
          ariaLabel="搜索配置项"
          className="w-full sm:max-w-sm"
        />
        {invalidKeys.size > 0 && <p className="text-xs text-danger">存在非法 JSON，修正后才能保存。</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-start">
        <nav
          className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible"
          aria-label="设置分组"
        >
          {schemaQuery.data.groups.map((group) => (
            <button
              key={group.key}
              type="button"
              onClick={() => scrollToSection(group.key)}
              aria-current={section === group.key ? 'true' : undefined}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                section === group.key
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
              )}
            >
              {group.label}
            </button>
          ))}
        </nav>

        <div className="grid min-w-0 gap-4">
          {groups.length === 0 && (
            <Card className="py-10 text-center text-sm text-subtle">没有匹配的配置项</Card>
          )}

          {groups.map((group) => (
            <Card key={group.key} id={`section-${group.key}`} className="scroll-mt-24 gap-0 py-0">
              <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                <div>
                  <h2 className="text-base">{group.label}</h2>
                  <p className="mt-1 text-xs text-subtle">{group.description}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => resetSection(group)} disabled={save.isPending}>
                  <RotateCcw /> 恢复默认
                </Button>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <FieldControl
                    key={`${field.key}-${formVersion}`}
                    field={field}
                    value={values[field.key]}
                    dirty={field.key in draft}
                    onChange={(value) => setField(field.key, value)}
                    onInvalidChange={(invalid) => markInvalid(field.key, invalid)}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <SaveBar
        count={dirtyKeys.length}
        pending={save.isPending}
        onDiscard={() => {
          setDraft({})
          setInvalidKeys(new Set())
          resetFieldDrafts()
        }}
        onSave={() => save.mutate()}
      />

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) { setImportError(null) } }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>导入配置</DialogTitle>
            <DialogDescription>将用导入文件整表替换当前配置。旧版导出缺少的键会回退默认值。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Textarea
              value={importText}
              onChange={(event) => { setImportText(event.target.value); setImportError(null) }}
              rows={10}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="粘贴 youlin-settings.json 内容"
              aria-invalid={Boolean(importError)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="file"
                accept=".json,application/json"
                className="h-9 max-w-xs"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  setImportText(await file.text())
                  setImportError(null)
                  event.target.value = ''
                }}
              />
              {parsedKeys !== null && <span className="text-[11px] text-subtle">识别到 {parsedKeys} 个配置键</span>}
            </div>
            {importError && <p role="alert" className="text-xs text-danger">{importError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importSettings.isPending}>取消</Button>
            <Button
              variant="destructive"
              onClick={() => importSettings.mutate()}
              disabled={parsedKeys === null || importSettings.isPending}
            >
              {importSettings.isPending ? '导入中…' : '整表替换'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
