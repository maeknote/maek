import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { IGNORED_ENTRIES, type DirEntry, type ListDirRequest, type ListDirResult } from '@shared/contract'
import { fsError } from '../errors'
import { getWorkspace } from '../workspaces'
import { isInsideWorkspace, resolveInWorkspace, toRelPath } from './guard'

/**
 * One level of children (8A). The tree loads lazily, and the same "expanded
 * folder" unit will later be the watch unit (2B), so tree state and watch state
 * stay one concept rather than two that drift.
 */
export async function listDir(req: ListDirRequest): Promise<ListDirResult> {
  const ws = getWorkspace(req.wsId)
  const abs = await resolveInWorkspace(ws, req.path)

  let dirents
  try {
    dirents = await readdir(abs, { withFileTypes: true })
  } catch (err) {
    // Includes EACCES on a permission-denied subfolder (T9): the tree shows an
    // inline error on that row and keeps the rest of the tree alive.
    throw fsError(err, req.path || '워크스페이스 루트')
  }

  const entries: DirEntry[] = []

  for (const dirent of dirents) {
    if (IGNORED_ENTRIES.includes(dirent.name)) continue

    const childAbs = path.join(abs, dirent.name)
    let kind: 'file' | 'dir'

    if (dirent.isSymbolicLink()) {
      // A symlink is the one entry kind that can escape the workspace, so it
      // is the only one worth a realpath round-trip. Non-symlink children of an
      // already-verified real directory are inside by construction.
      if (!(await isInsideWorkspace(ws, childAbs))) continue
      try {
        kind = (await stat(childAbs)).isDirectory() ? 'dir' : 'file'
      } catch {
        continue // broken link or unreadable target
      }
    } else if (dirent.isDirectory()) {
      kind = 'dir'
    } else if (dirent.isFile()) {
      kind = 'file'
    } else {
      continue // sockets, fifos, devices
    }

    entries.push({ name: dirent.name, path: toRelPath(ws, childAbs), kind })
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'ko')
  })

  return { entries }
}
