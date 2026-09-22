import { z } from 'zod'

/**
 * RPC contract v0 — the single source of truth shared by server and client.
 *
 * Path rule (cross-check 2 / X2): every filesystem call is addressed as
 * `{ wsId, path }` where `path` is RELATIVE to the workspace root. Absolute
 * paths exist in exactly two places: the `root` returned by pickDirectory /
 * openWorkspace (so the client can show it and remember it), and the server's
 * in-memory workspace registry. No handler ever accepts an absolute path.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * A workspace-relative path. `''` is the workspace root itself.
 * Rejected here (cheaply, before the realpath guard) : absolute paths,
 * Windows drive letters, backslashes, and NUL bytes. `..` segments are NOT
 * rejected lexically — the server's realpath guard is the authority, and it
 * also catches symlinks that lexical checks cannot see.
 */
export const RelPath = z
  .string()
  .max(4096)
  .refine((p) => !p.includes('\0'), { message: 'path must not contain NUL' })
  .refine((p) => !p.startsWith('/'), { message: 'path must be relative' })
  .refine((p) => !/^[a-zA-Z]:/.test(p), { message: 'path must be relative' })
  .refine((p) => !p.includes('\\'), { message: 'path must use forward slashes' })

export const WsId = z.string().min(1).max(64)

export const WorkspaceRef = z.object({
  wsId: WsId,
  /** Absolute, realpath-resolved root. Display and Workspace restoration. */
  root: z.string(),
  /** Basename of the root, for the window/gate label. */
  name: z.string()
})
export type WorkspaceRef = z.infer<typeof WorkspaceRef>

// ---------------------------------------------------------------------------
// pickDirectory — native OS dialog spawned by the server (3A)
// ---------------------------------------------------------------------------

export const PickDirectoryRequest = z.object({})

export const PickDirectoryResult = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), workspace: WorkspaceRef }),
  z.object({ status: z.literal('canceled') }),
  /** No usable native dialog on this platform/session — client shows a path input. */
  z.object({ status: z.literal('fallback'), reason: z.string() })
])
export type PickDirectoryResult = z.infer<typeof PickDirectoryResult>

// ---------------------------------------------------------------------------
// openWorkspace — path-input fallback and reopening a remembered Workspace
// ---------------------------------------------------------------------------

export const OpenWorkspaceRequest = z.object({
  /** Absolute path. The only place the client may send one. */
  path: z.string().min(1)
})
export type OpenWorkspaceRequest = z.infer<typeof OpenWorkspaceRequest>

export const OpenWorkspaceResult = z.object({ workspace: WorkspaceRef })
export type OpenWorkspaceResult = z.infer<typeof OpenWorkspaceResult>

// ---------------------------------------------------------------------------
// listDir — one level of children (8A)
// ---------------------------------------------------------------------------

export const DirEntry = z.object({
  name: z.string(),
  /** Workspace-relative, forward-slashed. */
  path: RelPath,
  kind: z.enum(['file', 'dir'])
})
export type DirEntry = z.infer<typeof DirEntry>

export const ListDirRequest = z.object({ wsId: WsId, path: RelPath })
export type ListDirRequest = z.infer<typeof ListDirRequest>

export const ListDirResult = z.object({ entries: z.array(DirEntry) })
export type ListDirResult = z.infer<typeof ListDirResult>

// ---------------------------------------------------------------------------
// readFile — server decides viewKind (7A) and supplies the conflict baseline
// ---------------------------------------------------------------------------

/**
 * editor      — text, small enough for Tiptap
 * readonly    — text, but > READONLY_BYTE_LIMIT; rendered without an editor
 * unsupported — binary / non-UTF-8; no content is sent
 */
export const ViewKind = z.enum(['editor', 'readonly', 'unsupported'])
export type ViewKind = z.infer<typeof ViewKind>

/** Above this size a file opens read-only instead of loading into Tiptap (7A). */
export const READONLY_BYTE_LIMIT = 1024 * 1024

export const ReadFileRequest = z.object({ wsId: WsId, path: RelPath })
export type ReadFileRequest = z.infer<typeof ReadFileRequest>

export const ReadFileResult = z.object({
  viewKind: ViewKind,
  /** Absent when viewKind === 'unsupported'. */
  content: z.string().optional(),
  size: z.number(),
  /** Floored to whole ms — see server/fs/stat flooring note. */
  mtimeMs: z.number(),
  /** sha256 of the file bytes; the hash half of the 5B conflict check. */
  hash: z.string()
})
export type ReadFileResult = z.infer<typeof ReadFileResult>

// ---------------------------------------------------------------------------
// writeFile — mtime + hash optimistic lock (1A / 5B / 6B)
// ---------------------------------------------------------------------------

export const WriteFileRequest = z.object({
  wsId: WsId,
  path: RelPath,
  content: z.string(),
  /** From the readFile (or previous writeFile) this edit is based on. */
  baseMtimeMs: z.number(),
  baseHash: z.string(),
  /**
   * Set by the conflict dialog's [덮어쓰기] / [이 위치에 다시 만들기] branches.
   * Never defaults to true — the destructive path must be chosen explicitly.
   */
  force: z.boolean().optional()
})
export type WriteFileRequest = z.infer<typeof WriteFileRequest>

export const WriteFileResult = z.object({
  ok: z.literal(true),
  mtimeMs: z.number(),
  hash: z.string()
})
export type WriteFileResult = z.infer<typeof WriteFileResult>

// ---------------------------------------------------------------------------
// createFile — the tree header's [+], and the empty-folder escape hatch
// ---------------------------------------------------------------------------

export const CreateFileRequest = z.object({
  wsId: WsId,
  /** Parent directory, workspace-relative. `''` = root. */
  dir: RelPath,
  /** Desired basename incl. extension. Server de-duplicates with ` 2`, ` 3`, … */
  name: z.string().min(1).max(255)
})
export type CreateFileRequest = z.infer<typeof CreateFileRequest>

export const CreateFileResult = z.object({ entry: DirEntry })
export type CreateFileResult = z.infer<typeof CreateFileResult>

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * conflict is the interesting one: it is the 1A/5B/6B optimistic-lock failure
 * and it is the only error the UI answers with a modal rather than a message.
 */
export const ConflictReason = z.enum(['changed', 'deleted'])
export type ConflictReason = z.infer<typeof ConflictReason>

export const ErrorCode = z.enum([
  'bad_request',
  'unknown_workspace',
  'outside_workspace',
  'not_found',
  'not_a_directory',
  'is_a_directory',
  'eacces',
  'conflict',
  'dialog_failed',
  'forbidden',
  'too_large',
  'invalid_json',
  'invalid_text',
  'mount_not_found',
  'resource_not_found',
  'read_only',
  'internal'
])
export type ErrorCode = z.infer<typeof ErrorCode>

export const RpcError = z.object({
  error: ErrorCode,
  message: z.string(),
  /** Present iff error === 'conflict'. */
  reason: ConflictReason.optional()
})
export type RpcError = z.infer<typeof RpcError>

// ---------------------------------------------------------------------------
// Method table — the client's rpc() is typed off this, so a contract change is
// a compile error on both sides rather than a runtime 400.
// ---------------------------------------------------------------------------

export const methods = {
  pickDirectory: { request: PickDirectoryRequest, result: PickDirectoryResult },
  openWorkspace: { request: OpenWorkspaceRequest, result: OpenWorkspaceResult },
  listDir: { request: ListDirRequest, result: ListDirResult },
  readFile: { request: ReadFileRequest, result: ReadFileResult },
  writeFile: { request: WriteFileRequest, result: WriteFileResult },
  createFile: { request: CreateFileRequest, result: CreateFileResult }
} as const

export type Methods = typeof methods
export type MethodName = keyof Methods
export type RequestOf<M extends MethodName> = z.infer<Methods[M]['request']>
export type ResultOf<M extends MethodName> = z.infer<Methods[M]['result']>

/** Default ignore list for the lazy tree (8A). */
export const IGNORED_ENTRIES: readonly string[] = ['.git', 'node_modules', '.DS_Store', '.obsidian']
