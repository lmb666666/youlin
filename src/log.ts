import pino from 'pino'

const LEVELS = new Set(['silent', 'debug', 'info', 'warn', 'error', 'fatal', 'trace'])

/** 非法 LOG_LEVEL 回退 info，避免 pino 在启动时抛错 */
export function resolveLogLevel(value = process.env.LOG_LEVEL): string {
  const level = value?.trim().toLowerCase()
  return level && LEVELS.has(level) ? level : 'info'
}

/** 结构化日志：默认 JSON 到 stdout；LOG_LEVEL=silent/debug/info/warn/error */
export const logger = pino({
  level: resolveLogLevel(),
  base: { service: 'youlin', pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
})
