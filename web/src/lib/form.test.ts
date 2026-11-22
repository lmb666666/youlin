import { describe, it, expect } from 'vitest'
import { emptyToUndefined } from './form'

describe('emptyToUndefined', () => {
  it('空串转 undefined（日期控件留空 = 未填）', () => {
    expect(emptyToUndefined('')).toBeUndefined()
  })

  it('合法值原样保留', () => {
    expect(emptyToUndefined('2026-01-01')).toBe('2026-01-01')
    expect(emptyToUndefined(undefined)).toBeUndefined()
    expect(emptyToUndefined(null)).toBe(null)
  })
})
