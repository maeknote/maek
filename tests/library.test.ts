import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LibraryStore } from '../server/library'
import { createApp } from '../server/app'

let root: string
let store: LibraryStore
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'maek-v1-test-'))
  store = new LibraryStore(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('Markdown library', () => {
  it('persists Korean Markdown and leading/trailing newlines across restarts', () => {
    const body =
      '\n\n## 한글 노트\n\n- [ ] 일 하기\n\n```ts\nconst x = 1\n```\n'
    const note = store.create({ title: '나의 생각', body, tags: ['일상'] })
    expect(new LibraryStore(root).get(note.id)).toEqual(note)
    expect(note.body).toBe(body)
    expect(
      readFileSync(path.join(root, 'notes', `${note.id}.md`), 'utf8')
    ).toContain(body)
  })
  it('rejects a stale save without losing either disk content or history', () => {
    const first = store.create({ title: '원본', body: 'first' })
    const second = store.update(first.id, first.revision, {
      ...first,
      body: 'second'
    })
    expect(() =>
      store.update(first.id, first.revision, { ...first, body: 'stale' })
    ).toThrow('다른 창')
    expect(store.get(first.id).body).toBe('second')
    expect(store.history(first.id)[0]?.body).toBe('first')
    expect(
      store.update(second.id, second.revision, { ...second, body: 'third' })
        .body
    ).toBe('third')
  })
  it('detects external edits and reads their fresh Markdown', () => {
    const note = store.create({ body: 'original' })
    const file = path.join(root, 'notes', `${note.id}.md`)
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('original', 'external')
    )
    expect(store.list()[0]?.body).toBe('external')
    expect(() => store.update(note.id, note.revision, note)).toThrow('다른 창')
  })
  it('moves a note to trash and restores it without removing its body', () => {
    const first = store.create({
      body: 'keep me',
      favorite: true,
      tags: ['보관']
    })
    const trashed = store.update(first.id, first.revision, {
      ...first,
      trashed: true
    })
    const restored = store.update(first.id, trashed.revision, {
      ...trashed,
      trashed: false
    })
    expect(restored).toMatchObject({
      body: 'keep me',
      favorite: true,
      tags: ['보관'],
      trashed: false
    })
    expect(store.history(first.id)).toHaveLength(2)
  })
  it('retains only 30 previous snapshots', () => {
    let note = store.create({ body: '0' })
    for (let n = 1; n <= 34; n++)
      note = store.update(note.id, note.revision, { ...note, body: String(n) })
    expect(store.history(note.id)).toHaveLength(30)
    expect(store.get(note.id).body).toBe('34')
  })
  it('validates database references and typed properties', () => {
    const id = randomUUID()
    const db = store.createDatabase({
      name: '프로젝트',
      fields: [{ id, name: '시간', type: 'number' }]
    })
    const note = store.create({
      databaseId: db.id,
      properties: { [id]: 3 },
      status: '진행 중'
    })
    expect(note.properties[id]).toBe(3)
    expect(() =>
      store.create({ databaseId: db.id, properties: { [id]: 'three' } })
    ).toThrow('속성 값')
    expect(() => store.create({ databaseId: randomUUID() })).toThrow(
      '데이터베이스'
    )
    expect(() =>
      store.create({
        databaseId: db.id,
        properties: { [randomUUID()]: 'extra' }
      })
    ).toThrow('알 수 없는 속성')
    expect(new LibraryStore(root).databases()).toEqual([db])
  })
  it('adds schema fields without modifying note bodies', () => {
    const db = store.createDatabase({ name: '작업', fields: [] })
    const note = store.create({ databaseId: db.id, body: '# Keep exactly\n\n' })
    store.addField(db.id, { id: randomUUID(), name: '기한', type: 'date' })
    expect(store.get(note.id)).toEqual(note)
  })
  it('rejects traversal and symlink notes', () => {
    expect(() => store.get('../../package.json')).toThrow()
    const id = randomUUID()
    symlinkSync(
      path.join(root, 'databases.json'),
      path.join(root, 'notes', `${id}.md`)
    )
    expect(() => store.get(id)).toThrow('일반 파일')
  })
})

describe('local API boundary', () => {
  it('serves notes, validates requests, and returns conflict status', async () => {
    const app = createApp(root)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/notes',
        payload: { title: 'API test' }
      })
      expect(created.statusCode).toBe(200)
      const note = created.json()
      const saved = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note.id}`,
        payload: { ...note, body: 'new' }
      })
      expect(saved.statusCode).toBe(200)
      const conflict = await app.inject({
        method: 'PUT',
        url: `/api/notes/${note.id}`,
        payload: note
      })
      expect(conflict.statusCode).toBe(409)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/notes',
            payload: { title: 42 }
          })
        ).statusCode
      ).toBe(400)
      expect((await app.inject('/api/library')).json().notes).toHaveLength(1)
    } finally {
      await app.close()
    }
  })
  it('rejects remote Host and cross-origin mutations, and removes folder RPCs', async () => {
    const app = createApp(root)
    try {
      expect(
        (
          await app.inject({
            url: '/api/library',
            headers: { host: 'attacker.example' }
          })
        ).statusCode
      ).toBe(403)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/notes',
            headers: { origin: 'https://attacker.example' },
            payload: {}
          })
        ).statusCode
      ).toBe(403)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/openWorkspace',
            payload: { path: '/' }
          })
        ).statusCode
      ).toBe(404)
    } finally {
      await app.close()
    }
  })
})
