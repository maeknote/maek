import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceRef } from "@shared/contract";
import type { DatabaseMeta } from "@shared/database";
import type { Change } from "@shared/workspace";
import { api } from "@renderer/shared/api";
import { queryClient } from "@renderer/shared/query-client";
import { useStore } from "@renderer/features/workspace";
import { useWorkspaceStore } from "./workspaceStore";
import { affectsDatabaseRegistry } from "./changeImpact";

export const databaseRegistryKey = (workspaceId: string) => ["database-registry", workspaceId] as const;
const registryOptions = (workspace: WorkspaceRef) => ({
  queryKey: databaseRegistryKey(workspace.wsId),
  staleTime: Infinity,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    api<DatabaseMeta[]>("/api/databases", "GET", undefined, workspace, signal),
});

export function fetchDatabaseRegistry(workspace: WorkspaceRef) {
  return queryClient.fetchQuery(registryOptions(workspace));
}

export function useDatabaseRegistry() {
  const workspace = useStore(state => state.workspace);
  const query = useQuery({
    ...registryOptions(workspace ?? { wsId: "", root: "", name: "" }),
    enabled: Boolean(workspace),
  });
  useEffect(() => {
    if (!workspace || !query.data) return;
    useWorkspaceStore.setState({ rootPath: workspace.root });
    useWorkspaceStore.getState().setDatabases(query.data);
  }, [workspace, query.data]);
  return query;
}

// A fixed window gives continuous updates during long bursts. All consumers
// share both the scheduled invalidation and the in-flight Query request.
let timer: ReturnType<typeof setTimeout> | undefined;
let scheduledWorkspace: string | undefined;
let refreshing = false;
let refreshAgain = false;
async function refreshRegistry(workspaceId: string) {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  const queryKey = databaseRegistryKey(workspaceId);
  // An event arriving during a request may be newer than its snapshot. Let
  // that request finish, then reconcile once, without cancelling/restarting it.
  refreshAgain = queryClient.getQueryState(queryKey)?.fetchStatus === "fetching";
  try {
    await queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
  } finally {
    refreshing = false;
    if (refreshAgain) {
      refreshAgain = false;
      const workspace = useStore.getState().workspace;
      if (workspace) scheduleRefresh(workspace.wsId);
    }
  }
}
function scheduleRefresh(workspaceId: string) {
  if (scheduledWorkspace !== workspaceId) { clearTimeout(timer); timer = undefined; }
  scheduledWorkspace = workspaceId;
  timer ??= setTimeout(() => {
    timer = undefined;
    if (useStore.getState().workspace?.wsId !== workspaceId) return;
    void refreshRegistry(workspaceId);
  }, 100);
}
window.addEventListener("maek:workspace-change", event => {
  const workspace = useStore.getState().workspace;
  if (!workspace) return;
  const databases = queryClient.getQueryData<DatabaseMeta[]>(databaseRegistryKey(workspace.wsId)) ?? [];
  if (affectsDatabaseRegistry((event as CustomEvent<Change>).detail, databases)) scheduleRefresh(workspace.wsId);
});
window.addEventListener("maek:workspace-rescan", () => {
  const workspace = useStore.getState().workspace;
  if (workspace) scheduleRefresh(workspace.wsId);
});
