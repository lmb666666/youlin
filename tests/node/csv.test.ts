import { describe, expect, it } from 'vitest'
import { csvCell } from '../../web/src/lib/csv'

describe('体检 CSV 单元格转义', () => {
  it('公式前缀加单引号，引号翻倍', () => {
    expect(csvCell('=cmd|calc')).toBe('"\'=cmd|calc"')
    expect(csvCell('+1')).toBe('"\'+1"')
    expect(csvCell('-1')).toBe('"\'-1"')
    expect(csvCell('@x')).toBe('"\'@x"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell(null)).toBe('""')
  })
})
