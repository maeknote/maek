import { queryClient } from "@renderer/shared/query-client";
import { useStore } from "@renderer/features/workspace";
import { useWorkspaceStore } from "./workspaceStore";
import type { Change } from "@shared/workspace";
import { affectsDatabaseRows } from "./changeImpact";

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
    if (!affectsDatabaseRows(change, database.folderPath)) continue;
    const key = keyFor(workspace.wsId, database.id);
    if (timers.has(key)) continue;
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      invalidate(workspace.wsId, database.id);
    }, 150));
  }
});
window.addEventListener("maek:workspace-rescan", () => {
  const workspace = useStore.getState().workspace;
  if (workspace) void queryClient.invalidateQueries({ queryKey: ["database-rows", workspace.wsId] });
});
