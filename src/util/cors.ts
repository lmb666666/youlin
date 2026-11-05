import type { AppConfig } from '../types'

/** 公开接口 CORS 头（/api/links、/api/circle、/apply） */
export function corsHeaders(cfg: AppConfig): Record<string, string> {
  const origin = cfg.api.corsOrigin || '*'
  const h: Record<string, string> = { 'Access-Control-Allow-Origin': origin }
  if (origin !== '*') h.Vary = 'Origin'
  return h
}
