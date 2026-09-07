import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { WorkspaceRef } from '@shared/contract'
import { RpcHttpError, badRequest, fsError } from './errors'

/**
 * The workspace registry — the only place absolute paths live on the server.
 *
 * In-memory on purpose: it dies with the process, which is correct for a tool
 * whose only run mode is `npm run dev`. The client keeps the *paths* in
 * localStorage (T14 recents) and re-registers them via openWorkspace, so a
 * wsId is a handle to this process, never a persisted identifier.
 */
export interface Workspace {
  wsId: string
  /** Absolute, realpath-resolved, no trailing separator. */
  root: string
  name: string
}

const byId = new Map<string, Workspace>()
const byRoot = new Map<string, string>()

/** Expand a leading `~` — the path-input fallback (3A) invites typing it. */
function expandHome(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return path.join(homedir(), trimmed.slice(2))
  return trimmed
}

export async function registerWorkspace(inputPath: string): Promise<Workspace> {
  const expanded = expandHome(inputPath)
  if (!path.isAbsolute(expanded)) {
    throw badRequest('절대 경로가 필요합니다')
  }

  let root: string
  try {
    // realpath here means every later containment check compares against a
    // canonical root; a symlinked workspace root would otherwise fail them all.
    root = await realpath(expanded)
  } catch (err) {
    throw fsError(err, '워크스페이스 폴더')
  }

  const stats = await stat(root).catch((err) => {
    throw fsError(err, '워크스페이스 폴더')
  })
  if (!stats.isDirectory()) {
    throw new RpcHttpError(400, 'not_a_directory', '폴더가 아닙니다')
  }

  const existingId = byRoot.get(root)
  if (existingId) {
    const existing = byId.get(existingId)
    if (existing) return existing
  }

  const workspace: Workspace = {
    wsId: randomUUID(),
    root,
    name: path.basename(root) || root
  }
  byId.set(workspace.wsId, workspace)
  byRoot.set(root, workspace.wsId)
  return workspace
}

export function getWorkspace(wsId: string): Workspace {
  const ws = byId.get(wsId)
  if (!ws) {
    // The client's cue to re-open from its recents list after a server restart.
    throw new RpcHttpError(404, 'unknown_workspace', '워크스페이스를 다시 열어주세요')
  }
  return ws
}

export function toRef(ws: Workspace): WorkspaceRef {
  return { wsId: ws.wsId, root: ws.root, name: ws.name }
}
