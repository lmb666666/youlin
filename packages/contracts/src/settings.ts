import { z } from 'zod'

export const settingsFieldTypeSchema = z.enum(['string', 'text', 'number', 'boolean', 'enum', 'stringList', 'json'])

export const settingsSchemaFieldSchema = z.object({
  key: z.string(),
  type: settingsFieldTypeSchema,
  default: z.unknown(),
  label: z.string(),
  description: z.string(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  placeholder: z.string().optional(),
  full: z.boolean().optional(),
})

export const settingsSchemaGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  fields: z.array(settingsSchemaFieldSchema),
})

export const settingsSchemaResponseSchema = z.object({
  version: z.number().int(),
  groups: z.array(settingsSchemaGroupSchema),
})

export const settingsValuesSchema = z.record(z.string(), z.unknown())

export const settingsResponseSchema = z.object({
  version: z.number().int(),
  values: settingsValuesSchema,
})

export type SettingsFieldType = z.infer<typeof settingsFieldTypeSchema>
export type SettingsSchemaField = z.infer<typeof settingsSchemaFieldSchema>
export type SettingsSchemaGroup = z.infer<typeof settingsSchemaGroupSchema>
export type SettingsSchemaResponse = z.infer<typeof settingsSchemaResponseSchema>
export type SettingsValues = z.infer<typeof settingsValuesSchema>
export type SettingsResponse = z.infer<typeof settingsResponseSchema>
