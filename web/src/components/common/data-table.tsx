import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface DataColumn<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  sortValue?: (row: T) => string | number
  align?: 'left' | 'right'
  className?: string
  mobileLabel?: string
  hideOnMobile?: boolean
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  sort,
  onSortChange,
  empty,
  actions,
  className,
}: {
  rows: T[]
  columns: DataColumn<T>[]
  getRowKey: (row: T) => string | number
  sort?: SortState
  onSortChange?: (sort: SortState) => void
  empty?: ReactNode
  actions?: (row: T) => ReactNode
  className?: string
}) {
  if (rows.length === 0 && empty) return <>{empty}</>

  const toggleSort = (key: string) => {
    if (!onSortChange) return
    const nextDir = sort?.key === key && sort.dir === 'asc' ? 'desc' : 'asc'
    onSortChange({ key, dir: nextDir })
  }

  return (
    <div className={className}>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b">
              {columns.map((column) => {
                const active = sort?.key === column.key
                const ariaSort = active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortValue ? ariaSort : undefined}
                    className={cn(
                      'px-3 py-2.5 font-medium whitespace-nowrap text-subtle',
                      column.align === 'right' && 'text-right',
                    )}
                  >
                    {column.sortValue && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-sm hover:text-foreground',
                          column.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {column.header}
                        {active ? (
                          sort?.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
              {actions && <th scope="col" className="px-3 py-2.5"><span className="sr-only">操作</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)} className="border-b last:border-0 hover:bg-secondary/60">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-3 align-middle text-muted-foreground',
                      column.align === 'right' && 'text-right',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
                {actions && <td className="px-3 py-3 text-right">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 md:hidden">
        {rows.map((row) => (
          <div key={getRowKey(row)} className="rounded-lg border bg-card p-3">
            <div className="grid gap-1.5">
              {columns.filter((column) => !column.hideOnMobile).map((column) => (
                <div key={column.key} className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2 text-xs">
                  <span className="text-subtle">{column.mobileLabel ?? column.header}</span>
                  <div className={cn('min-w-0 text-muted-foreground', column.align === 'right' && 'text-right')}>
                    {column.cell(row)}
                  </div>
                </div>
              ))}
            </div>
            {actions && <div className="mt-2 flex justify-end border-t pt-2">{actions(row)}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
