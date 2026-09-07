import { readFile as fsReadFile, writeFile as fsWriteFile, stat } from 'node:fs/promises'
import type { WriteFileRequest, WriteFileResult } from '@shared/contract'
import { RpcHttpError, conflict, fsError, isErrno } from '../errors'
import { getWorkspace } from '../workspaces'
import { resolveInWorkspace } from './guard'
import { flooredMtime, sha256 } from './readFile'

/**
 * Optimistic locking on save (1A + 5B + 6B).
 *
 * Writing unconditionally is the easy thing and the wrong thing: an edit made
 * in another editor between open and save disappears without a trace. So every
 * save first proves the file is still what we read.
 *
 *   mtime differs          → 409 changed
 *   mtime same, hash differs → 409 changed  (5B: 1-second mtime resolution on
 *                                            NAS/SMB/iCloud hides same-second edits)
 *   file gone              → 409 deleted   (6B: never silently re-create)
 *
 * KNOWN LIMIT — TOCTOU. Between the stat/hash check and the write there is a
 * window in which an external process can change the file; we overwrite it and
 * say nothing. Accepted for a single-user local tool where the window is
 * milliseconds. Closing it needs file locking or atomic replace. See README.
 */
export async function writeFile(req: WriteFileRequest): Promise<WriteFileResult> {
  const ws = getWorkspace(req.wsId)
  const abs = await resolveInWorkspace(ws, req.path)
  const force = req.force === true

  let stats
  try {
    stats = await stat(abs)
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      // 6B: the file was deleted or renamed under us. Auto-recreating would
      // resurrect a deliberate deletion, or leave a duplicate under the old
      // name after a rename. Stop and ask — unless the user already answered.
      if (!force) {
        throw conflict('deleted', '편집 중이던 파일이 사라졌습니다')
      }
      stats = null
    } else {
      throw fsError(err, req.path)
    }
  }

  if (stats?.isDirectory()) {
    throw new RpcHttpError(400, 'is_a_directory', `${req.path}: 폴더입니다`)
  }

  if (stats && !force) {
    if (flooredMtime(stats.mtimeMs) !== req.baseMtimeMs) {
      throw conflict('changed', '파일이 밖에서 바뀌었습니다')
    }
    // mtime matched — but that is not enough where mtime resolution is 1s (5B).
    const current = await fsReadFile(abs).catch((err) => {
      throw fsError(err, req.path)
    })
    if (sha256(current) !== req.baseHash) {
      throw conflict('changed', '파일이 밖에서 바뀌었습니다')
    }
  }

  const bytes = Buffer.from(req.content, 'utf-8')
  try {
    await fsWriteFile(abs, bytes)
  } catch (err) {
    // T9: a read-only file is a defined outcome, not an opaque 500.
    throw fsError(err, req.path)
  }

  const after = await stat(abs).catch((err) => {
    throw fsError(err, req.path)
  })

  return { ok: true, mtimeMs: flooredMtime(after.mtimeMs), hash: sha256(bytes) }
}
