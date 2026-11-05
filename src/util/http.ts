import type { Context } from 'hono'

export function jsonError(status: number, code: string, message: string, details?: unknown): Response {
  return Response.json({ error: { code, message, ...(details !== undefined ? { details } : {}) } }, { status })
}

/** 把 zod issue 转成 { 字段: 消息 } */
export function fieldDetails(issues: { path: (string | number | symbol)[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of issues) {
    const key = i.path.join('.') || '_'
    if (!(key in out)) out[key] = i.message
  }
  return out
}

/** 数据库报错是否为「表未迁移」（启动迁移失败/数据库文件异常） */
export function isMissingTableError(message: string): boolean {
  return /no such table|no such column/i.test(message)
}

/** 唯一索引冲突（check-then-act 竞态的兜底信号） */
export function isUniqueConstraintError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e)
  return /UNIQUE constraint failed/i.test(message)
}

/** 解析请求体 JSON；失败返回 undefined 并已写响应 */
export async function readJson(c: Context): Promise<unknown | undefined> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

export type LimitedJson =
  | { ok: true; value: unknown }
  | { ok: false; response: Response }

/**
 * 公开接口的 JSON 解析：先看 Content-Length，再对流式读取做累计上限。
 * 不能直接 c.req.json()——它会先把整个 body 读进内存，超大请求可以打爆 Node 进程。
 */
export async function readJsonLimited(c: Context, maxBytes: number): Promise<LimitedJson> {
  const declared = Number(c.req.header('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: jsonError(413, 'payload_too_large', `请求体超过 ${maxBytes} 字节`) }
  }

  const body = c.req.raw.body
  if (!body) {
    return { ok: false, response: jsonError(400, 'invalid_json', '请求体须为 JSON') }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return { ok: false, response: jsonError(413, 'payload_too_large', `请求体超过 ${maxBytes} 字节`) }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', '读取请求体失败') }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { ok: false, response: jsonError(400, 'invalid_json', '请求体须为 JSON') }
  }
}
