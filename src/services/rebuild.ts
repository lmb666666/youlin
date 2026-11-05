import { triggerRebuild } from '../rebuild'
import { runDetached } from '../util/bg'
import type { AppConfig, Env } from '../types'

/** 数据变化后的可选重建：不阻塞响应；失败只记录日志 */
export function maybeAutoRebuild(env: Env, cfg: AppConfig, reason: string): void {
  if (cfg.rebuild.enabled && cfg.rebuild.auto) {
    runDetached(triggerRebuild(env, cfg, reason))
  }
}
