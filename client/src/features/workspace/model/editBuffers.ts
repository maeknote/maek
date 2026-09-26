/**
 * Generic edit-buffer registry for file-backed views.
 *
 * A view (e.g. the CSV spreadsheet) registers a buffer for its tab so the
 * Workspace can, without importing any feature-specific code, flush unconfirmed
 * in-progress edits to the store before saving, closing, or copying — and know
 * whether such edits exist for dirty tracking and the beforeunload warning.
 *
 * The registry is keyed by the tab's runtime editor-session id (path-independent
 * so a rename does not detach the buffer). It intentionally holds only opaque
 * callbacks; the spreadsheet feature owns the actual draft/command logic.
 */

export interface EditBuffer {
  /**
   * Confirm the in-progress draft and any queued command, updating the store so
   * the tab's bodyContent reflects the latest input. Resolves once the tab is
   * in a saveable state. Must be safe to call when there is nothing pending.
   */
  flush: () => Promise<void>;
  /** Discard the in-progress draft and any queued command without saving. */
  discard: () => void;
  /** Whether the buffer currently holds unconfirmed input or a pending command. */
  hasPending: () => boolean;
}

const buffers = new Map<string, EditBuffer>();

/** Register (or replace) the edit buffer for a session. Returns an unregister fn. */
export function registerEditBuffer(sessionId: string, buffer: EditBuffer): () => void {
  buffers.set(sessionId, buffer);
  return () => {
    // Only remove if it is still the same buffer instance.
    if (buffers.get(sessionId) === buffer) buffers.delete(sessionId);
  };
}

/** Remove and dispose a session's buffer (reload, close, workspace change). */
export function disposeEditBuffer(sessionId: string): void {
  buffers.delete(sessionId);
}

/** True when the session has unconfirmed input or a pending command. */
export function hasPendingEdit(sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  const buffer = buffers.get(sessionId);
  return buffer ? buffer.hasPending() : false;
}

/** Flush the session's buffer to the store, if one is registered. */
export async function flushEditBuffer(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const buffer = buffers.get(sessionId);
  if (buffer) await buffer.flush();
}

/** Discard the session's in-progress edits without saving. */
export function discardEditBuffer(sessionId: string | undefined): void {
  if (!sessionId) return;
  buffers.get(sessionId)?.discard();
}

/** Whether any registered buffer currently has pending edits. */
export function anyPendingEdits(): boolean {
  for (const buffer of buffers.values()) if (buffer.hasPending()) return true;
  return false;
}
