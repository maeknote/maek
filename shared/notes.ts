import { z } from 'zod'

export const idSchema = z.string().uuid()
export const statusSchema = z.enum(['할 일', '진행 중', '완료'])
export const fieldSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(60),
  type: z.enum(['text', 'number', 'date', 'checkbox', 'select']),
  options: z.array(z.string().trim().min(1).max(60)).max(30).default([])
})
export const databaseSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  fields: z.array(fieldSchema).max(30),
  createdAt: z.string()
})
export const noteInputSchema = z.object({
  title: z.string().max(300).default(''),
  body: z.string().max(2_000_000).default(''),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  favorite: z.boolean().default(false),
  trashed: z.boolean().default(false),
  template: z.boolean().default(false),
  databaseId: idSchema.nullable().default(null),
  status: statusSchema.default('할 일'),
  properties: z
    .record(
      z.string().uuid(),
      z.union([
        z.string().max(2000),
        z.number().finite(),
        z.boolean(),
        z.null()
      ])
    )
    .default({})
})
export const noteSchema = noteInputSchema.extend({
  id: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.string()
})
export type Note = z.infer<typeof noteSchema>
export type NoteInput = z.infer<typeof noteInputSchema>
export type Database = z.infer<typeof databaseSchema>
export type Field = z.infer<typeof fieldSchema>
export type Library = { notes: Note[]; databases: Database[] }
export function noteTitle(note: Pick<Note, 'title'>) {
  return note.title.trim() || '제목 없는 노트'
}
