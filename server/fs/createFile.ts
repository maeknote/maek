import { writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { CreateFileRequest, CreateFileResult } from '@shared/contract'
import { RpcHttpError, badRequest, fsError, isErrno } from '../errors'
import { getWorkspace } from '../workspaces'
import { resolveInWorkspace, toRelPath } from './guard'

/**
 * New note (design: 마이크로 사양 — tree header `+`).
 *
 * In scope for milestone 1 because without it an empty folder is a dead end:
 * the EMPTY state promises a next action and this is that action.
 */
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return false
    throw err
  }
}

/** `note.md` → `note 2.md` → `note 3.md`, extension preserved. */
async function uniquePath(dirAbs: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)

  let candidate = path.join(dirAbs, name)
  let n = 2
  while (await exists(candidate)) {
    candidate = path.join(dirAbs, `${stem} ${n}${ext}`)
    n += 1
    if (n > 1000) throw new RpcHttpError(500, 'internal', '사용 가능한 파일 이름을 찾지 못했습니다')
  }
  return candidate
}

export async function createFile(req: CreateFileRequest): Promise<CreateFileResult> {
  const ws = getWorkspace(req.wsId)

  // The name is a basename, never a path — otherwise it becomes a second,
  // unguarded way to address the filesystem.
  if (req.name.includes('/') || req.name.includes('\\') || req.name.includes('\0')) {
    throw badRequest('파일 이름에 경로 구분자를 쓸 수 없습니다')
  }
  if (req.name === '.' || req.name === '..') {
    throw badRequest('사용할 수 없는 파일 이름입니다')
  }

  const dirAbs = await resolveInWorkspace(ws, req.dir)
  const dirStats = await stat(dirAbs).catch((err) => {
    throw fsError(err, req.dir || '워크스페이스 루트')
  })
  if (!dirStats.isDirectory()) {
    throw new RpcHttpError(400, 'not_a_directory', `${req.dir}: 폴더가 아닙니다`)
  }

  const abs = await uniquePath(dirAbs, req.name)
  try {
    // 'wx' — never clobber, even if something appeared since uniquePath ran.
    await writeFile(abs, '', { encoding: 'utf-8', flag: 'wx' })
  } catch (err) {
    throw fsError(err, path.basename(abs))
  }

  return {
    entry: { name: path.basename(abs), path: toRelPath(ws, abs), kind: 'file' }
  }
}
