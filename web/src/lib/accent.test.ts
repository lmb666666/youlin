import { beforeEach, describe, expect, it } from 'vitest'
import { applyAccentColor, clearAccentColor } from './accent'

describe('applyAccentColor', () => {
  beforeEach(() => {
    document.documentElement.className = ''
    clearAccentColor()
  })

  it('sets primary and picks a dark foreground for a light accent', () => {
    applyAccentColor('#ff0000')
    const style = document.documentElement.style
    expect(style.getPropertyValue('--primary')).toBe('#ff0000')
    expect(style.getPropertyValue('--primary-foreground')).toBe('#1f1e1d')
    expect(style.getPropertyValue('--ring')).toContain('#ff0000')
  })

  it('picks a light foreground for a dark accent', () => {
    applyAccentColor('#111111')
    expect(document.documentElement.style.getPropertyValue('--primary-foreground')).toBe('#fffaf5')
  })

  it('ignores invalid colors and clears overrides', () => {
    applyAccentColor('#ff0000')
    applyAccentColor('red; background: black')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
  })
})
