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

/** 解析请求体 JSON；失败返回 undefined 并已写响应 */
export async function readJson(c: Context): Promise<unknown | undefined> {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}
