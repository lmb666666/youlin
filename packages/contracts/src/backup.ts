import { z } from 'zod'

export const backupTargetSchema = z.enum(['download', 'webdav', 'pre-restore'])

export const backupStatusSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  target: backupTargetSchema,
  bytes: z.number().int().optional(),
  file: z.string().optional(),
  error: z.string().optional(),
})

export const backupStatusResponseSchema = z.object({
  last: backupStatusSchema.nullable(),
  backup: z.object({
    enabled: z.boolean(),
    schedule: z.string(),
    includeArticles: z.boolean(),
    retain: z.number().int(),
  }),
  webdav: z.object({
    configured: z.boolean(),
    url: z.string(),
    path: z.string(),
  }),
})

export const backupPreviewSchema = z.object({
  version: z.number().int(),
  exportedAt: z.string(),
  appVersion: z.string().nullable(),
  counts: z.object({
    groups: z.number().int(),
    friends: z.number().int(),
    applications: z.number().int(),
    articles: z.number().int(),
    settings: z.number().int(),
  }),
  includeArticles: z.boolean(),
})

export const restoreSummarySchema = z.object({
  groups: z.number().int(),
  friends: z.number().int(),
  applications: z.number().int(),
  articles: z.number().int(),
  sourceState: z.number().int(),
  settings: z.number().int(),
  settingsSkipped: z.number().int(),
})

export const restoreResponseSchema = z.object({
  ok: z.literal(true),
  summary: restoreSummarySchema,
  preRestoreFile: z.string().nullable(),
})

export const davFileSchema = z.object({
  name: z.string(),
  size: z.number().int(),
  lastModified: z.string().optional(),
})

export const davListResponseSchema = z.object({ files: z.array(davFileSchema) })

export const davTestResponseSchema = z.object({ ok: z.literal(true), files: z.number().int() })

export const davRunResponseSchema = z.object({
  ok: z.literal(true),
  status: backupStatusSchema,
  pruned: z.number().int(),
})

export type BackupTarget = z.infer<typeof backupTargetSchema>
export type BackupStatus = z.infer<typeof backupStatusSchema>
export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>
export type BackupPreview = z.infer<typeof backupPreviewSchema>
export type RestoreSummary = z.infer<typeof restoreSummarySchema>
export type RestoreResponse = z.infer<typeof restoreResponseSchema>
export type DavFile = z.infer<typeof davFileSchema>
export type DavListResponse = z.infer<typeof davListResponseSchema>
export type DavTestResponse = z.infer<typeof davTestResponseSchema>
export type DavRunResponse = z.infer<typeof davRunResponseSchema>
