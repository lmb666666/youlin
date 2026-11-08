const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function normalizeHex(value: string): string | null {
  const trimmed = value.trim()
  if (!HEX.test(trimmed)) return null
  const raw = trimmed.slice(1)
  if (raw.length === 3) {
    return `#${raw.split('').map((ch) => ch + ch).join('').toLowerCase()}`
  }
  return `#${raw.toLowerCase()}`
}

function luminance(hex: string): number {
  const raw = hex.slice(1)
  const channels = [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 强调色只接受 #rgb / #rrggbb；前景色按对比度在深/浅之间自动选择。 */
export function applyAccentColor(value: string): void {
  const root = document.documentElement
  const keys = [
    '--primary',
    '--primary-hover',
    '--primary-foreground',
    '--ring',
    '--sidebar-primary',
    '--sidebar-primary-foreground',
  ]

  const hex = normalizeHex(value)
  if (!hex) {
    for (const key of keys) root.style.removeProperty(key)
    return
  }

  const dark = root.classList.contains('dark')
  const foreground = contrast(hex, '#1f1e1d') >= contrast(hex, '#fffaf5') ? '#1f1e1d' : '#fffaf5'

  root.style.setProperty('--primary', hex)
  root.style.setProperty('--primary-hover', `color-mix(in oklab, ${hex} 84%, ${dark ? '#ffffff' : '#000000'})`)
  root.style.setProperty('--primary-foreground', foreground)
  root.style.setProperty('--ring', `color-mix(in oklab, ${hex} 72%, ${dark ? '#ffffff' : '#000000'})`)
  root.style.setProperty('--sidebar-primary', hex)
  root.style.setProperty('--sidebar-primary-foreground', foreground)
}

export function clearAccentColor(): void {
  applyAccentColor('')
}
