import { z } from 'zod'
import { AppError } from '../errors'
import { parseInput } from './validation'
import { isUniqueConstraintError } from '../util/http'
import {
  createGroup as insertGroup,
  deleteGroupCascade,
  findGroupById,
  groupNameTaken,
  listGroups,
  reorderGroups as writeGroupOrder,
  updateGroup as writeGroup,
} from '../repositories/groups'
import type { Db } from '../types'

export const groupCreateSchema = z.object({
  name: z.string().min(1).max(100),
  desc: z.string().max(2000).optional().nullable(),
  sort: z.number().int().optional(),
})
export const groupUpdateSchema = groupCreateSchema.partial()
export const groupReorderSchema = z.object({
  items: z.array(z.object({ id: z.number().int(), sort: z.number().int() })).min(1),
})

export interface GroupView {
  id: number
  name: string
  desc?: string
  sort: number
  friendCount: number
}

export function listGroupViews(db: Db): GroupView[] {
  return listGroups(db).map((g) => ({
    id: g.id,
    name: g.name,
    desc: g.desc ?? undefined,
    sort: g.sort,
    friendCount: g.friendCount,
  }))
}

export function createGroup(db: Db, raw: unknown): { id: number } {
  const input = parseInput(groupCreateSchema, raw)
  if (groupNameTaken(db, input.name)) throw new AppError(409, 'duplicate_name', '同名分组已存在')
  try {
    return { id: insertGroup(db, input) }
  } catch (e) {
    // 并发创建撞 groups.name 唯一索引，check-then-insert 的竞态兜底
    if (!isUniqueConstraintError(e)) throw e
    throw new AppError(409, 'duplicate_name', '同名分组已存在')
  }
}

export function updateGroup(db: Db, id: number, raw: unknown): void {
  const input = parseInput(groupUpdateSchema, raw)
  if (!findGroupById(db, id)) throw new AppError(404, 'not_found', '分组不存在')
  if (input.name !== undefined && groupNameTaken(db, input.name, id)) {
    throw new AppError(409, 'duplicate_name', '同名分组已存在')
  }
  try {
    writeGroup(db, id, input)
  } catch (e) {
    if (!isUniqueConstraintError(e)) throw e
    throw new AppError(409, 'duplicate_name', '同名分组已存在')
  }
}

export function deleteGroup(db: Db, id: number): void {
  deleteGroupCascade(db, id)
}

export function reorderGroups(db: Db, raw: unknown): void {
  writeGroupOrder(db, parseInput(groupReorderSchema, raw).items)
}
