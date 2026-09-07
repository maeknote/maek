import {
  mkdtemp,
  mkdir,
  readFile as fsRead,
  rm,
  stat,
  utimes,
  writeFile as fsWrite
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFile } from '../server/fs/createFile'
import { listDir } from '../server/fs/listDir'
import { readFile } from '../server/fs/readFile'
import { writeFile } from '../server/fs/writeFile'
import { registerWorkspace, type Workspace } from '../server/workspaces'

let base: string
let ws: Workspace

const abs = (rel: string) => path.join(ws.root, rel)

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'omm-files-'))
  const root = path.join(base, 'notes')
  await mkdir(root)
  ws = await registerWorkspace(root)
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/**
 * A whole-second timestamp, so pinning mtime to it is exact.
 *
 * Anything with sub-second precision drifts by ±1ms here: `stat().mtime` as a
 * Date re-rounds the nanosecond APFS timestamp, and `ms / 1000` is not exactly
 * representable as a float. Either drift would silently make the hash-fallback
 * test below pass through the *mtime* branch instead — the branch it exists to
 * bypass.
 */
const PINNED_SECONDS = 1_700_000_000

/** Rewrite content while holding mtime fixed, simulating the 1-second-resolution
 *  filesystems (NAS/SMB/iCloud) where an external edit hides behind mtime. */
async function rewriteAtPinnedMtime(rel: string, content: string) {
  await fsWrite(abs(rel), content)
  await utimes(abs(rel), PINNED_SECONDS, PINNED_SECONDS)
}

describe('writeFile — mtime + hash optimistic lock (1A / 5B / 6B)', () => {
  beforeEach(async () => {
    await fsWrite(abs('note.md'), '# 원본\n')
  })

  it('writes when the baseline matches, and returns the new baseline', async () => {
    const read = await readFile({ wsId: ws.wsId, path: 'note.md' })

    const res = await writeFile({
      wsId: ws.wsId,
      path: 'note.md',
      content: '# 수정됨\n',
      baseMtimeMs: read.mtimeMs,
      baseHash: read.hash
    })

    expect(res.ok).toBe(true)
    expect(await fsRead(abs('note.md'), 'utf-8')).toBe('# 수정됨\n')

    // The returned baseline must be immediately reusable for the next save.
    await expect(
      writeFile({
        wsId: ws.wsId,
        path: 'note.md',
        content: '# 또 수정\n',
        baseMtimeMs: res.mtimeMs,
        baseHash: res.hash
      })
    ).resolves.toMatchObject({ ok: true })
  })

  it('409 changed when mtime moved under us', async () => {
    const read = await readFile({ wsId: ws.wsId, path: 'note.md' })
    await fsWrite(abs('note.md'), '# 외부 편집\n')
    await utimes(abs('note.md'), new Date(), new Date(Date.now() + 5000))

    await expect(
      writeFile({
        wsId: ws.wsId,
        path: 'note.md',
        content: '# 내 편집\n',
        baseMtimeMs: read.mtimeMs,
        baseHash: read.hash
      })
    ).rejects.toMatchObject({ status: 409, code: 'conflict', reason: 'changed' })

    // The external edit must still be on disk — that is the whole point.
    expect(await fsRead(abs('note.md'), 'utf-8')).toBe('# 외부 편집\n')
  })

  it('409 changed when mtime is unchanged but the content differs (5B hash fallback)', async () => {
    await rewriteAtPinnedMtime('note.md', '# 원본\n')
    const read = await readFile({ wsId: ws.wsId, path: 'note.md' })
    expect(read.mtimeMs).toBe(PINNED_SECONDS * 1000)

    await rewriteAtPinnedMtime('note.md', '# 같은 초 안의 외부 편집\n')

    const after = await stat(abs('note.md'))
    // Precondition: mtime really is identical, so a rejection below can only
    // have come from the hash comparison.
    expect(Math.floor(after.mtimeMs)).toBe(read.mtimeMs)

    await expect(
      writeFile({
        wsId: ws.wsId,
        path: 'note.md',
        content: '# 내 편집\n',
        baseMtimeMs: read.mtimeMs,
        baseHash: read.hash
      })
    ).rejects.toMatchObject({ status: 409, code: 'conflict', reason: 'changed' })
  })

  it('409 deleted when the file is gone, and never re-creates it silently (6B)', async () => {
    const read = await readFile({ wsId: ws.wsId, path: 'note.md' })
    await rm(abs('note.md'))

    await expect(
      writeFile({
        wsId: ws.wsId,
        path: 'note.md',
        content: '# 내 편집\n',
        baseMtimeMs: read.mtimeMs,
        baseHash: read.hash
      })
    ).rejects.toMatchObject({ status: 409, code: 'conflict', reason: 'deleted' })

    await expect(stat(abs('note.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('force overwrites a changed file (the 덮어쓰기 branch)', async () => {
    const read = await readFile({ wsId: ws.wsId, path: 'note.md' })
    await fsWrite(abs('note.md'), '# 외부 편집\n')
    await utimes(abs('note.md'), new Date(), new Date(Date.now() + 5000))

    await writeFile({
      wsId: ws.wsId,
      path: 'note.md',
      content: '# 내 편집\n',
      baseMtimeMs: read.mtimeMs,
      baseHash: read.hash,
      force: true
    })

    expect(await fsRead(abs('note.md'), 'utf-8')).toBe('# 내 편집\n')
  })

  it('force re-creates a deleted file (the 다시 만들기 branch)', async () => {
    const read = await readFile({ wsId: ws.wsId, path: 'note.md' })
    await rm(abs('note.md'))

    await writeFile({
      wsId: ws.wsId,
      path: 'note.md',
      content: '# 되살림\n',
      baseMtimeMs: read.mtimeMs,
      baseHash: read.hash,
      force: true
    })

    expect(await fsRead(abs('note.md'), 'utf-8')).toBe('# 되살림\n')
  })

  it('refuses to write outside the workspace', async () => {
    await expect(
      writeFile({
        wsId: ws.wsId,
        path: '../escaped.md',
        content: 'x',
        baseMtimeMs: 0,
        baseHash: '',
        force: true
      })
    ).rejects.toMatchObject({ code: 'outside_workspace' })
  })
})

describe('readFile — viewKind (7A)', () => {
  it('editor for a normal markdown file', async () => {
    await fsWrite(abs('small.md'), '# 작은 파일\n')
    const res = await readFile({ wsId: ws.wsId, path: 'small.md' })
    expect(res.viewKind).toBe('editor')
    expect(res.content).toBe('# 작은 파일\n')
    expect(res.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('readonly above 1MB, with content still available for rendering', async () => {
    await fsWrite(abs('big.md'), 'a'.repeat(1024 * 1024 + 1))
    const res = await readFile({ wsId: ws.wsId, path: 'big.md' })
    expect(res.viewKind).toBe('readonly')
    expect(res.content).toHaveLength(1024 * 1024 + 1)
  })

  it('unsupported for binary content, with no content sent', async () => {
    await fsWrite(abs('image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]))
    const res = await readFile({ wsId: ws.wsId, path: 'image.png' })
    expect(res.viewKind).toBe('unsupported')
    expect(res.content).toBeUndefined()
  })

  it('unsupported for invalid UTF-8', async () => {
    await fsWrite(abs('latin1.md'), Buffer.from([0xff, 0xfe, 0x41, 0x42]))
    const res = await readFile({ wsId: ws.wsId, path: 'latin1.md' })
    expect(res.viewKind).toBe('unsupported')
  })

  it('rejects a directory', async () => {
    await mkdir(abs('folder'))
    await expect(readFile({ wsId: ws.wsId, path: 'folder' })).rejects.toMatchObject({
      code: 'is_a_directory'
    })
  })

  it('404s a missing file', async () => {
    await expect(readFile({ wsId: ws.wsId, path: 'nope.md' })).rejects.toMatchObject({
      code: 'not_found'
    })
  })
})

describe('listDir — lazy children + ignore list (8A)', () => {
  it('lists one level, directories first, ignoring the default set', async () => {
    await mkdir(abs('.git'))
    await mkdir(abs('node_modules'))
    await mkdir(abs('ideas'))
    await fsWrite(abs('.DS_Store'), '')
    await fsWrite(abs('b.md'), '')
    await fsWrite(abs('a.md'), '')
    await fsWrite(abs('ideas/deep.md'), '')

    const { entries } = await listDir({ wsId: ws.wsId, path: '' })

    expect(entries.map((e) => e.name)).toEqual(['ideas', 'a.md', 'b.md'])
    // One level only — the nested file is not included.
    expect(entries.some((e) => e.path.includes('deep'))).toBe(false)
    expect(entries[0]).toMatchObject({ kind: 'dir', path: 'ideas' })
  })

  it('lists a subdirectory by relative path', async () => {
    await mkdir(abs('ideas'))
    await fsWrite(abs('ideas/deep.md'), '')

    const { entries } = await listDir({ wsId: ws.wsId, path: 'ideas' })
    expect(entries).toEqual([{ name: 'deep.md', path: 'ideas/deep.md', kind: 'file' }])
  })

  it('404s a missing directory', async () => {
    await expect(listDir({ wsId: ws.wsId, path: 'nope' })).rejects.toMatchObject({
      code: 'not_found'
    })
  })
})

describe('createFile', () => {
  it('creates an empty note and de-duplicates the name', async () => {
    const first = await createFile({ wsId: ws.wsId, dir: '', name: '새 노트.md' })
    expect(first.entry.path).toBe('새 노트.md')
    expect(await fsRead(abs('새 노트.md'), 'utf-8')).toBe('')

    const second = await createFile({ wsId: ws.wsId, dir: '', name: '새 노트.md' })
    expect(second.entry.name).toBe('새 노트 2.md')
  })

  it('refuses a name containing a path separator', async () => {
    await expect(
      createFile({ wsId: ws.wsId, dir: '', name: '../escaped.md' })
    ).rejects.toMatchObject({ code: 'bad_request' })
  })
})
