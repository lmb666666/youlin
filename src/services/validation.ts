import type { ZodType } from 'zod'
import { AppError, validationError } from '../errors'
import { fieldDetails } from '../util/http'

/** 用 zod 解析输入；失败统一抛 400，details 为字段错误 */
export function parseInput<T>(schema: ZodType<T>, input: unknown, message = '字段校验失败'): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw validationError(fieldDetails(parsed.error.issues), message)
  return parsed.data
}

/** 路径参数 id：非整数统一 400 */
export function parseId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id)) throw new AppError(400, 'invalid_id', 'id 不合法')
  return id
}
