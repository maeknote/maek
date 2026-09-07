import type { ConflictReason, ErrorCode } from '@shared/contract'

/** An error that maps cleanly onto the RpcError shape in the contract. */
export class RpcHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly reason?: ConflictReason
  ) {
    super(message)
    this.name = 'RpcHttpError'
  }
}

export const badRequest = (m: string) => new RpcHttpError(400, 'bad_request', m)
export const notFound = (m: string) => new RpcHttpError(404, 'not_found', m)
export const outsideWorkspace = (m: string) => new RpcHttpError(403, 'outside_workspace', m)
export const conflict = (reason: ConflictReason, m: string) =>
  new RpcHttpError(409, 'conflict', m, reason)

function errno(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null
    ? (err as NodeJS.ErrnoException).code
    : undefined
}

export function isErrno(err: unknown, code: string): boolean {
  return errno(err) === code
}

/**
 * Map a Node fs error onto the contract (T9 — EACCES and permission-denied
 * directories are defined rather than surfacing as an opaque 500).
 */
export function fsError(err: unknown, what: string): RpcHttpError {
  switch (errno(err)) {
    case 'ENOENT':
      return new RpcHttpError(404, 'not_found', `${what}: 찾을 수 없습니다`)
    case 'EACCES':
    case 'EPERM':
      return new RpcHttpError(403, 'eacces', `${what}: 접근 권한이 없습니다`)
    case 'ENOTDIR':
      return new RpcHttpError(400, 'not_a_directory', `${what}: 폴더가 아닙니다`)
    case 'EISDIR':
      return new RpcHttpError(400, 'is_a_directory', `${what}: 폴더입니다`)
    default:
      return new RpcHttpError(500, 'internal', `${what}: ${(err as Error)?.message ?? '알 수 없는 오류'}`)
  }
}
