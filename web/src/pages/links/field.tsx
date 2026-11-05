import { cloneElement, isValidElement, useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'

export function Field({ label, htmlFor, error, children }: {
  label: string
  htmlFor?: string
  error?: string
  children: ReactNode
}) {
  const autoId = useId()
  const id = htmlFor ?? autoId
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      {htmlFor || !isValidElement(children) ? children : cloneElement(children as React.ReactElement<{ id?: string }>, { id })}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
