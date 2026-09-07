import type {
  ConflictReason,
  ErrorCode,
  MethodName,
  RequestOf,
  ResultOf
} from '@shared/contract'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly reason?: ConflictReason
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The 1A/5B/6B optimistic-lock failure — the only error answered by a modal. */
  get isConflict(): boolean {
    return this.code === 'conflict'
  }

  /** The server restarted and lost its in-memory workspace registry. */
  get isUnknownWorkspace(): boolean {
    return this.code === 'unknown_workspace'
  }
}

/**
 * The whole client/server surface. Typed off the contract's method table, so a
 * contract change breaks compilation here rather than 400ing at runtime.
 */
export async function rpc<M extends MethodName>(
  method: M,
  params: RequestOf<M>
): Promise<ResultOf<M>> {
  let res: Response
  try {
    res = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params)
    })
  } catch (err) {
    throw new ApiError(0, 'internal', `서버에 연결할 수 없습니다: ${String(err)}`)
  }

  const text = await res.text()
  let body: unknown = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new ApiError(res.status, 'internal', '서버 응답을 해석할 수 없습니다')
    }
  }

  if (!res.ok) {
    const e = body as { error?: ErrorCode; message?: string; reason?: ConflictReason }
    throw new ApiError(res.status, e.error ?? 'internal', e.message ?? '요청이 실패했습니다', e.reason)
  }

  return body as ResultOf<M>
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
