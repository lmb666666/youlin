import { backupEnvelope, type BackupEnvelope } from './format'
import { jsonError } from '../util/http'

/** 备份文件编解码：gzip（两者运行时都原生支持 CompressionStream） */

export const BACKUP_MAX_BYTES = 16 * 1024 * 1024
export const BACKUP_MAX_INFLATED = 64 * 1024 * 1024

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export type DecodedBackup =
  | { ok: true; envelope: BackupEnvelope }
  | { ok: false; response: Response }

/**
 * 解码并校验上传的备份：
 *  - 允许 .json 与 .json.gz（按魔数判断，不看文件名）
 *  - 解压体积有上限，避免压缩炸弹
 *  - 版本号严格匹配，避免用新格式覆盖旧实例
 */
export async function decodeBackup(bytes: Uint8Array): Promise<DecodedBackup> {
  if (bytes.length === 0) {
    return { ok: false, response: jsonError(400, 'empty_file', '备份文件为空') }
  }
  if (bytes.length > BACKUP_MAX_BYTES) {
    return { ok: false, response: jsonError(413, 'file_too_large', `备份文件超过 ${BACKUP_MAX_BYTES / 1024 / 1024} MB`) }
  }

  let raw: Uint8Array
  if (isGzip(bytes)) {
    try {
      raw = await gunzipBytes(bytes)
    } catch {
      return { ok: false, response: jsonError(400, 'bad_gzip', '无法解压：文件不是有效的 gzip') }
    }
    if (raw.byteLength > BACKUP_MAX_INFLATED) {
      return { ok: false, response: jsonError(413, 'file_too_large', '解压后的备份体积超出上限') }
    }
  } else {
    raw = bytes
  }

  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', '备份文件不是合法 JSON') }
  }

  const parsed = backupEnvelope.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first && first.path.length > 0 ? `（${first.path.join('.')}）` : ''
    return {
      ok: false,
      response: jsonError(400, 'invalid_backup', `备份格式不正确${where}：${first?.message ?? '无法识别'}`),
    }
  }
  return { ok: true, envelope: parsed.data }
}
