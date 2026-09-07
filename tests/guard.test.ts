import { mkdtemp, mkdir, symlink, writeFile as fsWriteFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RpcHttpError } from '../server/errors'
import { resolveInWorkspace, toRelPath } from '../server/fs/guard'
import { registerWorkspace, type Workspace } from '../server/workspaces'

/**
 * T2 verify: `../`, symlinks and out-of-root absolute paths are all refused.
 *
 * This guard is data integrity, not the (deliberately omitted) security layer:
 * one bad join or one symlink is enough to write outside the note folder, and
 * that is the single failure the file-is-truth model cannot undo.
 */
describe('resolveInWorkspace', () => {
  let base: string
  let ws: Workspace
  let outside: string

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'omm-guard-'))
    const root = path.join(base, 'notes')
    outside = path.join(base, 'outside')

    await mkdir(root)
    await mkdir(outside)
    await mkdir(path.join(root, 'sub'))
    await fsWriteFile(path.join(root, 'a.md'), '# a\n')
    await fsWriteFile(path.join(outside, 'secret.md'), 'secret\n')

    await symlink(path.join(outside, 'secret.md'), path.join(root, 'escape.md'))
    await symlink(outside, path.join(root, 'escape-dir'))
    await symlink(path.join(root, 'a.md'), path.join(root, 'inside-link.md'))

    ws = await registerWorkspace(root)
  })

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  const expectRejected = async (relPath: string) => {
    await expect(resolveInWorkspace(ws, relPath)).rejects.toMatchObject({
      code: 'outside_workspace'
    })
  }

  it('accepts the workspace root itself', async () => {
    await expect(resolveInWorkspace(ws, '')).resolves.toBe(ws.root)
  })

  it('accepts a plain file and a nested directory', async () => {
    await expect(resolveInWorkspace(ws, 'a.md')).resolves.toBe(path.join(ws.root, 'a.md'))
    await expect(resolveInWorkspace(ws, 'sub')).resolves.toBe(path.join(ws.root, 'sub'))
  })

  it('accepts a path that does not exist yet (new file, or 6B recreate)', async () => {
    await expect(resolveInWorkspace(ws, 'sub/new.md')).resolves.toBe(
      path.join(ws.root, 'sub', 'new.md')
    )
  })

  it('rejects ../ escapes, including deeply nested ones', async () => {
    await expectRejected('../outside/secret.md')
    await expectRejected('sub/../../outside/secret.md')
    await expectRejected('..')
  })

  it('rejects an absolute path smuggled in as the relative path', async () => {
    await expectRejected('/etc/passwd')
    await expectRejected(path.join(outside, 'secret.md'))
  })

  it('rejects a symlinked FILE pointing outside the workspace', async () => {
    await expectRejected('escape.md')
  })

  it('rejects a path that traverses a symlinked DIRECTORY out of the workspace', async () => {
    await expectRejected('escape-dir/secret.md')
    // Also when the leaf does not exist — the ancestor still escapes.
    await expectRejected('escape-dir/brand-new.md')
  })

  it('accepts a symlink that stays inside the workspace', async () => {
    await expect(resolveInWorkspace(ws, 'inside-link.md')).resolves.toBe(
      path.join(ws.root, 'inside-link.md')
    )
  })

  it('rejects a sibling directory sharing the root name prefix', async () => {
    // `/tmp/x/notes-other` must not pass a naive startsWith(`/tmp/x/notes`).
    await mkdir(path.join(base, 'notes-other'), { recursive: true })
    await expectRejected('../notes-other')
  })

  it('throws RpcHttpError so the route layer maps it to 403', async () => {
    await expect(resolveInWorkspace(ws, '../outside')).rejects.toBeInstanceOf(RpcHttpError)
  })

  it('produces forward-slashed workspace-relative paths', () => {
    expect(toRelPath(ws, path.join(ws.root, 'sub', 'b.md'))).toBe('sub/b.md')
    expect(toRelPath(ws, ws.root)).toBe('')
  })
})

describe('registerWorkspace', () => {
  let base: string

  beforeAll(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'omm-ws-'))
    await mkdir(path.join(base, 'notes'))
    await fsWriteFile(path.join(base, 'file.md'), 'x')
  })

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('returns the same wsId for the same root', async () => {
    const a = await registerWorkspace(path.join(base, 'notes'))
    const b = await registerWorkspace(path.join(base, 'notes'))
    expect(a.wsId).toBe(b.wsId)
  })

  it('rejects a relative path', async () => {
    await expect(registerWorkspace('notes')).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('rejects a file', async () => {
    await expect(registerWorkspace(path.join(base, 'file.md'))).rejects.toMatchObject({
      code: 'not_a_directory'
    })
  })

  it('rejects a missing path', async () => {
    await expect(registerWorkspace(path.join(base, 'nope'))).rejects.toMatchObject({
      code: 'not_found'
    })
  })
})
