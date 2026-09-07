import { randomUUID, createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  lstatSync,
  unlinkSync
} from 'node:fs'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import {
  databaseSchema,
  idSchema,
  noteInputSchema,
  noteSchema,
  type Database,
  type Note,
  type NoteInput
} from '../shared/notes'
import { splitFrontmatterFile } from '../shared/frontmatter'

export class LibraryError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message)
  }
}
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex')

/** One local server serializes mutations. Markdown is authoritative; each save
 * checks a content revision, snapshots the previous version, then renames atomically. */
export class LibraryStore {
  constructor(readonly root: string) {
    for (const folder of [
      root,
      path.join(root, 'notes'),
      path.join(root, 'history')
    ]) {
      mkdirSync(folder, { recursive: true })
      if (lstatSync(folder).isSymbolicLink())
        throw new Error('데이터 폴더는 심볼릭 링크일 수 없습니다.')
    }
    if (!existsSync(this.catalogPath)) this.atomic(this.catalogPath, '[]\n')
  }
  private get catalogPath() {
    return path.join(this.root, 'databases.json')
  }
  private notePath(id: string) {
    return path.join(this.root, 'notes', `${idSchema.parse(id)}.md`)
  }
  private read(file: string) {
    if (!existsSync(file))
      throw new LibraryError(404, '노트를 찾을 수 없습니다.')
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())
      throw new LibraryError(400, '일반 파일만 읽을 수 있습니다.')
    return readFileSync(file, 'utf8')
  }
  private atomic(file: string, raw: string) {
    const tmp = `${file}.${randomUUID()}.tmp`
    writeFileSync(tmp, raw, { flag: 'wx', mode: 0o600 })
    renameSync(tmp, file)
  }
  private decode(raw: string, id: string): Note {
    const split = splitFrontmatterFile(raw)
    const meta = split.frontmatterRaw ? parse(split.frontmatterRaw) : {}
    return noteSchema.parse({
      ...meta,
      id,
      body: split.body,
      revision: hash(raw)
    })
  }
  private encode(note: Note) {
    const { body, revision: _revision, ...meta } = note
    return `---\n${stringify(meta)}---\n\n${body}`
  }
  get(id: string) {
    return this.decode(this.read(this.notePath(id)), id)
  }
  list() {
    return readdirSync(path.join(this.root, 'notes'))
      .filter((name) => /^[0-9a-f-]{36}\.md$/.test(name))
      .map((name) => this.get(name.slice(0, -3)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  databases(): Database[] {
    return z
      .array(databaseSchema)
      .parse(JSON.parse(this.read(this.catalogPath)))
  }
  private validate(input: NoteInput) {
    if (!input.databaseId) return
    const db = this.databases().find((db) => db.id === input.databaseId)
    if (!db) throw new LibraryError(400, '데이터베이스를 찾을 수 없습니다.')
    for (const [key, value] of Object.entries(input.properties)) {
      const field = db.fields.find((field) => field.id === key)
      if (!field) throw new LibraryError(400, '알 수 없는 속성입니다.')
      if (value === null || value === '') continue
      const valid =
        field.type === 'number'
          ? typeof value === 'number'
          : field.type === 'checkbox'
            ? typeof value === 'boolean'
            : typeof value === 'string' &&
              (field.type !== 'select' || field.options.includes(value)) &&
              (field.type !== 'date' ||
                (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
                  !Number.isNaN(Date.parse(value))))
      if (!valid)
        throw new LibraryError(
          400,
          `${field.name} 속성 값이 올바르지 않습니다.`
        )
    }
  }
  create(data: unknown) {
    const input = noteInputSchema.parse(data)
    this.validate(input)
    const now = new Date().toISOString()
    const note: Note = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      revision: ''
    }
    this.atomic(this.notePath(note.id), this.encode(note))
    return this.get(note.id)
  }
  update(id: string, revision: string, data: unknown) {
    const current = this.get(id)
    if (current.revision !== revision)
      throw new LibraryError(
        409,
        '다른 창이나 프로그램에서 변경된 노트입니다. 편집본을 복사하거나 최신 버전을 불러오세요.'
      )
    const input = noteInputSchema.parse(data)
    this.validate(input)
    const file = this.notePath(id)
    const history = path.join(this.root, 'history', id)
    mkdirSync(history, { recursive: true })
    if (lstatSync(history).isSymbolicLink())
      throw new LibraryError(400, '잘못된 기록 폴더입니다.')
    this.atomic(path.join(history, `${current.revision}.md`), this.read(file))
    this.atomic(
      file,
      this.encode({ ...current, ...input, updatedAt: new Date().toISOString() })
    )
    const versions = readdirSync(history)
      .filter((n) => n.endsWith('.md'))
      .sort(
        (a, b) =>
          lstatSync(path.join(history, b)).mtimeMs -
          lstatSync(path.join(history, a)).mtimeMs
      )
    for (const old of versions.slice(30)) unlinkSync(path.join(history, old))
    return this.get(id)
  }
  history(id: string) {
    this.get(id)
    const dir = path.join(this.root, 'history', id)
    if (!existsSync(dir)) return []
    if (lstatSync(dir).isSymbolicLink())
      throw new LibraryError(400, '잘못된 기록 폴더입니다.')
    return readdirSync(dir)
      .filter((name) => /^[a-f0-9]{64}\.md$/.test(name))
      .map((name) => this.decode(this.read(path.join(dir, name)), id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  createDatabase(data: unknown) {
    const input = databaseSchema.pick({ name: true, fields: true }).parse(data)
    if (new Set(input.fields.map((f) => f.id)).size !== input.fields.length)
      throw new LibraryError(400, '속성 ID가 중복됩니다.')
    const db: Database = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    }
    this.atomic(
      this.catalogPath,
      JSON.stringify([...this.databases(), db], null, 2)
    )
    return db
  }
  addField(id: string, data: unknown) {
    const field = databaseSchema.shape.fields.element.parse(data)
    const databases = this.databases()
    const db = databases.find((db) => db.id === idSchema.parse(id))
    if (!db) throw new LibraryError(404, '데이터베이스를 찾을 수 없습니다.')
    if (db.fields.some((f) => f.id === field.id || f.name === field.name))
      throw new LibraryError(400, '같은 속성이 이미 있습니다.')
    db.fields.push(field)
    databaseSchema.parse(db)
    this.atomic(this.catalogPath, JSON.stringify(databases, null, 2))
    return db
  }
}
