/** 业务错误：由 app.onError 统一映射为 HTTP JSON，路由与 service 不构造 Response */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function validationError(details?: unknown, message = '字段校验失败'): AppError {
  return new AppError(400, 'validation_failed', message, details)
}

export function notFound(message: string, code = 'not_found'): AppError {
  return new AppError(404, code, message)
}
