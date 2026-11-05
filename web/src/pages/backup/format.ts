import { formatDateTime, type DateTimeOptions } from '@/lib/format'

export function fmtBytes(n: number | undefined): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function fmtTime(iso: string, opts: DateTimeOptions): string {
  return formatDateTime(iso, opts)
}

/** 文件名里的时间是 UTC；展示时按 site.timezone / site.locale 转换 */
export function fmtBackupName(name: string, opts: DateTimeOptions): string {
  const m = /^(youlin-backup|pre-restore)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json\.gz$/.exec(name)
  if (!m) return name
  const kind = m[1] === 'pre-restore' ? '恢复前存档' : '备份'
  const at = new Date(`${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`)
  return Number.isNaN(at.getTime())
    ? `${kind} · ${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}:${m[7]} UTC`
    : `${kind} · ${formatDateTime(at.toISOString(), opts)}`
}

export const TARGET_LABEL = { download: '下载', webdav: 'WebDAV', 'pre-restore': '恢复前存档' } as const
