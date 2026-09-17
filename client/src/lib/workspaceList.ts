/**
 * Pure helpers for the browser's recent-workspace list.
 *
 * The list is a per-browser convenience only. Mutations here NEVER touch the
 * filesystem or a workspace's `.maek` files — removing an entry just drops it
 * from this list. The store persists the result to `localStorage`.
 */

export interface RecentWorkspace {
  id: string;
  name: string;
  path: string;
}

/** Maximum recent workspaces retained, matching the app's policy. */
export const MAX_RECENT_WORKSPACES = 30;

/**
 * Removes a workspace from the list by path. Returns a new array; every other
 * entry is preserved unchanged and in order. This is non-destructive: it only
 * edits the in-memory/localStorage list, not the folder on disk.
 */
export function removeWorkspaceFromList<T extends RecentWorkspace>(
  workspaces: readonly T[],
  path: string,
): T[] {
  return workspaces.filter((w) => w.path !== path);
}

/**
 * Adds/moves a workspace to the front of the list, de-duplicating by path and
 * capping the length at MAX_RECENT_WORKSPACES.
 */
export function addWorkspaceToList<T extends RecentWorkspace>(
  workspaces: readonly T[],
  entry: T,
): T[] {
  return [
    ...new Map(
      [entry, ...workspaces].map((w) => [w.path, w]),
    ).values(),
  ].slice(0, MAX_RECENT_WORKSPACES);
}
