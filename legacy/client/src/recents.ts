const STORAGE_KEY = 'oh-my-maek:recent-workspaces'
const MAX_RECENTS = 8

export interface RecentWorkspace {
  path: string
  name: string
  lastOpenedAt: number
}

/**
 * Recent workspaces live in localStorage, not on the server (T14 / decision 2B).
 * The server's registry is in-memory and dies with the process, so the client
 * owns "which folders do I come back to" and re-registers a path on demand.
 */
export function readRecents(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (r): r is RecentWorkspace =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as RecentWorkspace).path === 'string' &&
          typeof (r as RecentWorkspace).name === 'string'
      )
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
      .slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

export function rememberRecent(entry: { path: string; name: string }): RecentWorkspace[] {
  const next = [
    { ...entry, lastOpenedAt: Date.now() },
    ...readRecents().filter((r) => r.path !== entry.path)
  ].slice(0, MAX_RECENTS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function forgetRecent(path: string): RecentWorkspace[] {
  const next = readRecents().filter((r) => r.path !== path)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
