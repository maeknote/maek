import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { outsideWorkspace, isErrno } from '../errors'
import type { Workspace } from '../../workspaces'

/**
 * Workspace path guard (cross-check 2 / X2).
 *
 * This is NOT the security layer — that was deliberately omitted (Accepted
 * Risks / D7). This is DATA INTEGRITY: without it a path-join bug or a single
 * symlink lets a write land outside the note folder, which is the one failure
 * the "files are the truth" model cannot recover from.
 *
 * The check is lexical first (cheap) and then realpath-based (authoritative,
 * because only realpath sees through symlinks).
 */

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/**
 * realpath() that tolerates a missing leaf: walks up to the deepest existing
 * ancestor, resolves that, and re-appends the missing segments. Needed because
 * writeFile targets a deleted file (6B) and createFile targets a new one —
 * both must still be proven to land inside the workspace.
 */
async function realpathAllowingMissing(p: string): Promise<string> {
  let current = p
  const missing: string[] = []

  for (;;) {
    try {
      const real = await realpath(current)
      return missing.length > 0 ? path.join(real, ...missing.reverse()) : real
    } catch (err) {
      if (!isErrno(err, 'ENOENT')) throw err
      const parent = path.dirname(current)
      // Reached the filesystem root without finding anything that exists.
      if (parent === current) throw err
      missing.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * Resolve a workspace-relative path to an absolute one, proving it stays
 * inside the workspace root. Throws `outside_workspace` otherwise.
 *
 * Returns the lexical path (not the realpath) so that operations act on the
 * path the user sees; the realpath is only used to prove containment.
 */
export async function resolveInWorkspace(ws: Workspace, relPath: string): Promise<string> {
  const candidate = path.resolve(ws.root, relPath)

  // Lexical check first — catches plain `../` without touching the disk.
  if (!isInside(ws.root, candidate)) {
    throw outsideWorkspace(`워크스페이스 밖의 경로입니다: ${relPath}`)
  }

  let real: string
  try {
    real = await realpathAllowingMissing(candidate)
  } catch {
    // Cannot prove containment (permission denied on an ancestor, broken
    // symlink chain). Refuse rather than guess.
    throw outsideWorkspace(`경로를 확인할 수 없습니다: ${relPath}`)
  }

  // Authoritative check — this is the one that catches symlinks.
  if (!isInside(ws.root, real)) {
    throw outsideWorkspace(`워크스페이스 밖을 가리키는 경로입니다: ${relPath}`)
  }

  return candidate
}

/**
 * Same containment proof for a path we already hold as absolute (a directory
 * entry produced by readdir). Used to drop symlinked entries that escape.
 */
export async function isInsideWorkspace(ws: Workspace, absPath: string): Promise<boolean> {
  if (!isInside(ws.root, absPath)) return false
  try {
    return isInside(ws.root, await realpathAllowingMissing(absPath))
  } catch {
    return false
  }
}

/** Workspace-relative, forward-slashed path for an absolute path inside it. */
export function toRelPath(ws: Workspace, absPath: string): string {
  return path.relative(ws.root, absPath).split(path.sep).join('/')
}
