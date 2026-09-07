import { create } from 'zustand'
import type { DirEntry, WorkspaceRef } from '@shared/contract'
import { ApiError, errorMessage, rpc } from './api'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'nochange' | 'error'

export interface DocMeta {
  /** Drives the tab's unsaved dot and the ⌘W close confirmation. */
  dirty: boolean
  status: SaveStatus
}

/** Tab id === workspace-relative path: one tab per file, for free. */
export interface Tab {
  id: string
  path: string
  name: string
}

export interface DirState {
  entries?: DirEntry[]
  loading: boolean
  error?: string
}

interface AppState {
  workspace: WorkspaceRef | null
  tabs: Tab[]
  activeTabId: string | null
  /** Lazily-loaded tree children, keyed by workspace-relative dir path (8A). */
  dirs: Record<string, DirState>
  docs: Record<string, DocMeta>
  explorerOpen: boolean
  /** Set when the server restarted and lost the workspace registry. */
  staleWorkspace: boolean

  setWorkspace: (ws: WorkspaceRef | null) => void
  loadDir: (path: string, opts?: { force?: boolean }) => Promise<void>
  openTab: (entry: { path: string; name: string }) => void
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  activateTabByOffset: (offset: number) => void
  setDoc: (id: string, patch: Partial<DocMeta>) => void
  toggleExplorer: (open?: boolean) => void
}

const emptyDoc: DocMeta = { dirty: false, status: 'idle' }

export const useStore = create<AppState>((set, get) => ({
  workspace: null,
  tabs: [],
  activeTabId: null,
  dirs: {},
  docs: {},
  explorerOpen: true,
  staleWorkspace: false,

  setWorkspace: (ws) => {
    set({
      workspace: ws,
      tabs: [],
      activeTabId: null,
      dirs: {},
      docs: {},
      staleWorkspace: false
    })
    if (ws) void get().loadDir('')
  },

  loadDir: async (path, opts) => {
    const ws = get().workspace
    if (!ws) return

    const existing = get().dirs[path]
    if (!opts?.force && (existing?.loading || existing?.entries)) return

    set((s) => ({ dirs: { ...s.dirs, [path]: { ...existing, loading: true, error: undefined } } }))

    try {
      const { entries } = await rpc('listDir', { wsId: ws.wsId, path })
      set((s) => ({ dirs: { ...s.dirs, [path]: { entries, loading: false } } }))
    } catch (err) {
      if (err instanceof ApiError && err.isUnknownWorkspace) {
        set({ staleWorkspace: true })
      }
      // The failure stays scoped to this row: the rest of the tree survives
      // and the row offers a retry (design: 인터랙션 상태 / ERROR).
      set((s) => ({
        dirs: { ...s.dirs, [path]: { ...s.dirs[path], loading: false, error: errorMessage(err) } }
      }))
    }
  },

  openTab: ({ path, name }) => {
    const { tabs } = get()
    if (!tabs.some((t) => t.id === path)) {
      set({ tabs: [...tabs, { id: path, path, name }] })
    }
    set({ activeTabId: path })
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const index = tabs.findIndex((t) => t.id === id)
    if (index === -1) return

    const next = tabs.filter((t) => t.id !== id)
    let nextActive = activeTabId

    if (activeTabId === id) {
      // Design 마이크로 사양: focus the tab to the right, else the one to the left.
      nextActive = next[index]?.id ?? next[index - 1]?.id ?? null
    }

    set((s) => {
      const docs = { ...s.docs }
      delete docs[id]
      return { tabs: next, activeTabId: nextActive, docs }
    })
  },

  activateTab: (id) => set({ activeTabId: id }),

  activateTabByOffset: (offset) => {
    const { tabs, activeTabId } = get()
    if (tabs.length === 0) return
    const current = tabs.findIndex((t) => t.id === activeTabId)
    const index = (((current === -1 ? 0 : current) + offset) % tabs.length + tabs.length) % tabs.length
    const target = tabs[index]
    if (target) set({ activeTabId: target.id })
  },

  setDoc: (id, patch) =>
    set((s) => ({ docs: { ...s.docs, [id]: { ...(s.docs[id] ?? emptyDoc), ...patch } } })),

  toggleExplorer: (open) => set((s) => ({ explorerOpen: open ?? !s.explorerOpen }))
}))

export function useDoc(id: string | null): DocMeta {
  return useStore((s) => (id ? s.docs[id] ?? emptyDoc : emptyDoc))
}
