/** 按 Unicode 码点截断到 max 字符，避免截出半个代理对（备份恢复 schema 的上限以此为准） */
export function clampText(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null
  if (v.length <= max) return v
  return Array.from(v).slice(0, max).join('')
}
