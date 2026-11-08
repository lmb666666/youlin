import { useState } from 'react'
import { cn } from '@/lib/utils'

const PALETTE = ['#b45309', '#0f766e', '#7c3aed', '#be123c', '#4d7c0f', '#0e7490', '#a16207']

function initialOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const chars = Array.from(trimmed)
  return (chars[0] ?? '?').toUpperCase()
}

function colorOf(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) % 997
  return PALETTE[hash % PALETTE.length]!
}

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const showImage = Boolean(src) && !failed
  const sizeClass = size === 'sm' ? 'size-7 text-[10px]' : size === 'lg' ? 'size-10 text-sm' : 'size-[34px] text-xs'

  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-border font-medium text-white',
        sizeClass,
        className,
      )}
      style={{ backgroundColor: colorOf(name) }}
      aria-hidden="true"
    >
      <span className="grid size-full place-items-center">{initialOf(name)}</span>
      {showImage && (
        <img
          src={src ?? undefined}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}
