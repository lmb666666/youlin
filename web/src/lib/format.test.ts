import { describe, expect, it } from 'vitest'
import { formatBytes, formatRelative } from './format'

describe('formatRelative', () => {
  it('formats recent and older dates', () => {
    const now = Date.now()
    expect(formatRelative(new Date(now - 30_000).toISOString())).toBe('刚刚')
    expect(formatRelative(new Date(now - 5 * 60_000).toISOString())).toBe('5分钟前')
    expect(formatRelative(new Date(now - 3 * 86_400_000).toISOString())).toBe('3天前')
  })

  it('returns a dash for empty values', () => {
    expect(formatRelative(null)).toBe('—')
  })
})

describe('formatBytes', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
