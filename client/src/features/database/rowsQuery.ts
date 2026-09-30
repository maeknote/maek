import { queryClient } from "@renderer/shared/query-client";
import { useStore } from "@renderer/features/workspace";
import { useWorkspaceStore } from "./workspaceStore";
import type { Change } from "@shared/workspace";

export const databaseRowsKey = (workspaceId: string, databaseId: string) =>
  ["database-rows", workspaceId, databaseId] as const;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const suspended = new Set<string>();
const pending = new Set<string>();
const keyFor = (workspaceId: string, databaseId: string) => `${workspaceId}:${databaseId}`;
function invalidate(workspaceId: string, databaseId: string) {
  const key = keyFor(workspaceId, databaseId);
  if (suspended.has(key)) { pending.add(key); return; }
  void queryClient.invalidateQueries({ queryKey: databaseRowsKey(workspaceId, databaseId) });
}
export function suspendDatabaseRows(workspaceId: string, databaseId: string) {
  suspended.add(keyFor(workspaceId, databaseId));
}
export function resumeDatabaseRows(workspaceId: string, databaseId: string) {
  const key = keyFor(workspaceId, databaseId);
  suspended.delete(key);
  if (pending.delete(key)) invalidate(workspaceId, databaseId);
}
window.addEventListener("maek:workspace-change", (event) => {
  const change = (event as CustomEvent<Change>).detail;
  const workspace = useStore.getState().workspace;
  if (!workspace || !change) return;
  for (const database of useWorkspaceStore.getState().databases) {
    const contains = (path: string) => database.folderPath === ''
      ? !path.includes('/') : path.startsWith(database.folderPath + '/') && !path.slice(database.folderPath.length + 1).includes('/');
    const rowChange = [change.path, change.source].some(path => path && /\.md$/i.test(path) && contains(path));
    const directoryChange = change.type.endsWith('Dir') || change.type === 'rename';
    const affectsFolder = directoryChange && [change.path, change.source].some(path => path !== undefined &&
      (database.folderPath === path || database.folderPath.startsWith(path + '/')));
    if (!rowChange && !affectsFolder && change.path !== '.maek/database.sqlite') continue;
    const key = keyFor(workspace.wsId, database.id);
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      invalidate(workspace.wsId, database.id);
    }, 150));
  }
});
