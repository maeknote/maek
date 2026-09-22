import { createHash } from 'node:crypto'
import { readFile as fsReadFile, stat } from 'node:fs/promises'
import {
  READONLY_BYTE_LIMIT,
  type ReadFileRequest,
  type ReadFileResult,
  type ViewKind
} from '@shared/contract'
import { RpcHttpError, fsError } from '../errors'
import { getWorkspace } from '../../workspaces'
import { resolveInWorkspace } from './guard'

/**
 * Above this we do not even read the bytes. A notes folder can contain a video;
 * hashing it to decide it is unsupported would be pure waste.
 */
const NO_READ_BYTE_LIMIT = 32 * 1024 * 1024

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * fs mtimeMs carries sub-millisecond float noise that does not survive JSON
 * round-tripping identically on every platform. Flooring everywhere makes the
 * 1A comparison an exact integer equality.
 */
export function flooredMtime(mtimeMs: number): number {
  return Math.floor(mtimeMs)
}

/**
 * The server decides viewKind (7A). It already stats the file for the 1A/5B
 * conflict baseline, so size is free — and handing a 10MB document to Tiptap
 * blocks the main thread for seconds.
 */
export async function readFile(req: ReadFileRequest): Promise<ReadFileResult> {
  const ws = getWorkspace(req.wsId)
  const abs = await resolveInWorkspace(ws, req.path)

  const stats = await stat(abs).catch((err) => {
    throw fsError(err, req.path)
  })
  if (stats.isDirectory()) {
    throw new RpcHttpError(400, 'is_a_directory', `${req.path}: 폴더입니다`)
  }

  const size = stats.size
  const mtimeMs = flooredMtime(stats.mtimeMs)

  if (size > NO_READ_BYTE_LIMIT) {
    // hash is empty because nothing was read. Safe: an unsupported file is
    // never the source of a writeFile, so no baseline is needed.
    return { viewKind: 'unsupported', size, mtimeMs, hash: '' }
  }

  const buf = await fsReadFile(abs).catch((err) => {
    throw fsError(err, req.path)
  })
  const hash = sha256(buf)

  let content: string
  try {
    // Keep an UTF-8 BOM in the returned string so CSV can round-trip it.
    // `ignoreBOM: true` means “do not interpret/remove the BOM”.
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf)
  } catch {
    return { viewKind: 'unsupported', size, mtimeMs, hash }
  }
  // Valid UTF-8 can technically contain NUL; real text does not.
  if (buf.includes(0)) {
    return { viewKind: 'unsupported', size, mtimeMs, hash }
  }

  const viewKind: ViewKind = size > READONLY_BYTE_LIMIT ? 'readonly' : 'editor'
  return { viewKind, content, size, mtimeMs, hash }
}
