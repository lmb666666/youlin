import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DataTable } from './data-table'

interface Row {
  id: number
  name: string
}

describe('DataTable', () => {
  it('toggles sort direction from the header', () => {
    const onSortChange = vi.fn()
    render(
      <DataTable
        rows={[{ id: 1, name: 'Liang' }]}
        getRowKey={(row) => row.id}
        sort={{ key: 'name', dir: 'asc' }}
        onSortChange={onSortChange}
        columns={[
          {
            key: 'name',
            header: '名称',
            cell: (row: Row) => row.name,
            sortValue: (row: Row) => row.name,
          },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /名称/ }))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', dir: 'desc' })
  })

  it('renders the mobile card variant with labels', () => {
    render(
      <DataTable
        rows={[{ id: 1, name: 'Liang' }]}
        getRowKey={(row) => row.id}
        columns={[{ key: 'name', header: '名称', cell: (row: Row) => row.name }]}
      />,
    )
    expect(screen.getAllByText('名称').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Liang').length).toBeGreaterThan(0)
  })
})
