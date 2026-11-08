import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './status-badge'

describe('StatusBadge', () => {
  it('renders the requested tone classes and label', () => {
    render(<StatusBadge tone="success">正常</StatusBadge>)
    const badge = screen.getByText('正常')
    expect(badge.className).toContain('text-success')
    expect(badge.className).toContain('bg-success-bg')
  })
})
