/**
 * ⌘S is a window-level shortcut but saving belongs to the mounted view, which
 * owns the Tiptap instance and the 1A conflict baseline. Views register a save
 * function here on mount; the shortcut handler calls the active tab's.
 *
 * Deliberately a plain module-level map rather than store state: registering a
 * callback is not something any component should re-render for.
 */
type SaveFn = () => void | Promise<void>

const saves = new Map<string, SaveFn>()

export function registerSave(tabId: string, fn: SaveFn): () => void {
  saves.set(tabId, fn)
  return () => {
    // Guard against a remount having already replaced the entry.
    if (saves.get(tabId) === fn) saves.delete(tabId)
  }
}

export function runSave(tabId: string | null): void {
  if (!tabId) return
  void saves.get(tabId)?.()
}
