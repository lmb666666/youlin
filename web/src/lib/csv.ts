/** CSV 单元格转义：引号翻倍，并对 Excel/WPS 公式前缀做防护 */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replaceAll('"', '""')}"`
}
