import { AppError } from '../errors'
import { applicationApproveSchema, applicationRejectSchema, manualRebuildSchema, type Application } from '@youlin/contracts'
import { isoUtc, dateOnly, dbTime } from '../util/time'
import { linkVariants } from '../util/link'
import { triggerRebuild, type RebuildResult } from '../rebuild'
import { ensureGroupByName, findGroupById } from '../repositories/groups'
import {
  approveApplication as commitApproval,
  findApplicationById,
  findFriendIdByLinks,
  listApplications,
  rejectApplication as commitRejection,
  type FriendInsert,
} from '../repositories/applications'
import type { ApplicationRow } from '../server/schema'
import type { AppConfig, Db, Env } from '../types'

export const applicationStatuses = ['pending', 'approved', 'rejected', 'all'] as const
export type ApplicationStatus = (typeof applicationStatuses)[number]

function shape(r: ApplicationRow): Application {
  return {
    id: r.id,
    siteName: r.siteName,
    author: r.author ?? undefined,
    link: r.link,
    avatar: r.avatar ?? undefined,
    feed: r.feed ?? undefined,
    desc: r.desc ?? undefined,
    contact: r.contact ?? undefined,
    note: r.note ?? undefined,
    backlink: {
      ok: r.backlinkOk === null ? null : r.backlinkOk === 1,
      checkedAt: isoUtc(r.backlinkCheckedAt) ?? null,
      detail: r.backlinkDetail ?? null,
    },
    status: r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending',
    reviewNote: r.reviewNote ?? undefined,
    createdAt: isoUtc(r.createdAt),
    reviewedAt: isoUtc(r.reviewedAt) ?? undefined,
  }
}

export function listApplicationViews(db: Db, status: string): Application[] {
  if (!applicationStatuses.includes(status as ApplicationStatus)) {
    throw new AppError(400, 'invalid_status', `status 须为 ${applicationStatuses.join(' / ')}`)
  }
  return listApplications(db, status as ApplicationStatus).map(shape)
}

export async function approveApplication(
  db: Db,
  env: Env,
  cfg: AppConfig,
  id: number,
  raw: unknown,
): Promise<{ friendId: number; rebuild: RebuildResult | null }> {
  const parsed = applicationApproveSchema.safeParse(raw ?? {})
  if (!parsed.success) throw new AppError(400, 'validation_failed', '字段校验失败')
  const overrides = parsed.data

  const application = findApplicationById(db, id)
  if (!application) throw new AppError(404, 'not_found', '申请不存在')
  if (application.status !== 'pending') {
    throw new AppError(409, 'already_reviewed', `该申请已处理（${application.status}）`)
  }

  const dupId = findFriendIdByLinks(db, linkVariants(application.link))
  if (dupId !== null) {
    throw new AppError(409, 'duplicate_link', `该链接已在友链中（#${dupId}），可先删除旧记录再通过`)
  }

  const groupId = overrides.groupId ?? ensureGroupByName(db, '未分组')
  if (!findGroupById(db, groupId)) throw new AppError(400, 'unknown_group', '分组不存在')

  const nowDb = dbTime(new Date().toISOString())
  // 覆盖值为空串时回退到申请值/站点名；空作者会破坏公开接口的 author 必填契约
  const author = overrides.author?.trim() || application.author?.trim() || application.siteName.trim()
  const title = overrides.title?.trim() || application.siteName.trim()
  const friend: Omit<FriendInsert, 'groupId'> = {
    author,
    title,
    desc: overrides.desc ?? application.desc,
    link: application.link,
    feed: overrides.feed === '' ? null : (overrides.feed ?? application.feed),
    avatar: overrides.avatar === '' ? null : (overrides.avatar ?? application.avatar),
    since: overrides.since ?? dateOnly(new Date())!,
    inCircle: 1,
    comment: application.note,
  }
  const friendId = commitApproval(db, id, groupId, friend, nowDb)

  // 通过后可选触发接入方重建（显式请求或 rebuild.auto + enabled）
  let rebuild: RebuildResult | null = null
  const wantRebuild = overrides.rebuild === true || (cfg.rebuild.enabled && cfg.rebuild.auto)
  if (wantRebuild && cfg.rebuild.enabled) {
    rebuild = await triggerRebuild(env, cfg, `application:${id}`)
  }

  return { friendId, rebuild }
}

export function rejectApplication(db: Db, id: number, raw: unknown): void {
  const parsed = applicationRejectSchema.safeParse(raw ?? {})
  if (!parsed.success) throw new AppError(400, 'validation_failed', '字段校验失败')

  const application = findApplicationById(db, id)
  if (!application) throw new AppError(404, 'not_found', '申请不存在')
  if (application.status !== 'pending') {
    throw new AppError(409, 'already_reviewed', `该申请已处理（${application.status}）`)
  }

  commitRejection(db, id, parsed.data.reason ?? null, dbTime(new Date().toISOString()))
}

/** 手动触发接入方重建，把结果映射为稳定错误码 */
export async function rebuildNow(env: Env, cfg: AppConfig, raw: unknown): Promise<{ provider?: string }> {
  const parsed = manualRebuildSchema.safeParse(raw ?? {})
  if (!parsed.success) throw new AppError(400, 'validation_failed', '字段校验失败')
  if (!cfg.rebuild.enabled) throw new AppError(400, 'rebuild_disabled', '重建功能未启用（rebuild.enabled）')

  const result = await triggerRebuild(env, cfg, parsed.data.reason ?? 'manual')
  if (result.triggered) return { provider: result.provider }
  if (result.debounced) throw new AppError(429, 'rebuild_debounced', '触发过于频繁，请稍后再试')
  if (result.error === 'webhook_url_missing' || result.error === 'github_repo_missing' || result.error === 'github_pat_missing') {
    throw new AppError(400, 'rebuild_misconfigured', `重建配置不完整：${result.error}`)
  }
  throw new AppError(502, 'rebuild_failed', `触发失败：${result.error}`)
}
