import { useId } from 'react'
import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** 表单字段外壳：标签、说明、错误。控件 id 由调用方传入。 */
export function FormField({
  id,
  label,
  hint,
  error,
  required = false,
  dirty = false,
  children,
  className,
  wide = false,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  dirty?: boolean
  children: ReactNode
  className?: string
  wide?: boolean
}) {
  return (
    <div className={cn('grid gap-1.5', wide && 'sm:col-span-2', className)}>
      <Label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-danger">*</span>}
        {dirty && (
          <span className="rounded-full border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[9px] font-normal text-warning">
            未保存
          </span>
        )}
      </Label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[11px] leading-relaxed text-subtle">
          {hint}
        </p>
      )}
    </div>
  )
}

/** 生成 aria 属性，避免每个页面手写 error/hint 关联。 */
export function fieldAria(id: string, error?: string, hint?: string) {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean)
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': ids.length > 0 ? ids.join(' ') : undefined,
  } as const
}

export function useFieldId(prefix: string): string {
  return `${prefix}-${useId().replace(/:/g, '')}`
}
