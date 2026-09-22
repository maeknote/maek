import { api } from "@renderer/shared/api";
import { useStore } from "@renderer/features/workspace";
import { useWorkspaceStore } from "./workspaceStore";
import type {
  DatabaseMeta,
  DatabaseRow,
  DatabaseColumnSchema,
  DatabaseCustomViewType,
  DatabaseViewConfig,
  DatabaseApplyKanbanDropRequest,
} from "@shared/database";
type Result<T> = ({ success: true } & T) | { success: false; error: string };
async function result<T>(task: () => Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, ...(await task()) };
  } catch (error) {
    const message = String(error);
    useStore.getState().setError(message);
    return { success: false, error: message };
  }
}
const snapshots = new Map<string, DatabaseRow[]>();
const queues = new Map<string, Promise<unknown>>();
async function command(
  databaseId: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  const workspace = useStore.getState().workspace;
  const key = `${workspace?.wsId}:${databaseId}`;
  const task = (queues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (useStore.getState().workspace?.wsId !== workspace?.wsId)
        throw new Error("Workspace changed");
      const meta = useWorkspaceStore
        .getState()
        .databases.find((d) => d.id === databaseId);
      const rowId = (data.rowId ??
        (data.rowMove as { rowId?: string } | undefined)?.rowId) as
        | string
        | undefined;
      const expectedRowHash = rowId
        ? snapshots.get(key)?.find((r) => r.id === rowId)?.hash
        : undefined;
      const response = await api<{
        database: DatabaseMeta;
        rows: DatabaseRow[];
        row: DatabaseRow;
      }>(
        "/api/databases/command",
        "POST",
        {
          databaseId,
          action,
          expectedUpdatedAt: meta?.updatedAt,
          expectedRowHash,
          ...data,
        },
        workspace,
      );
      if (useStore.getState().workspace?.wsId !== workspace?.wsId)
        throw new Error("Workspace changed");
      snapshots.set(key, response.rows);
      if (
        response.database &&
        response.database.updatedAt !== meta?.updatedAt
      ) {
        const store = useWorkspaceStore.getState();
        store.setDatabases(
          store.databases.map((d) =>
            d.id === databaseId ? response.database : d,
          ),
        );
      }
      return response;
    });
  queues.set(key, task);
  try {
    return await task;
  } finally {
    if (queues.get(key) === task) queues.delete(key);
  }
}

export const databaseApi = {
  databaseGetAll: (_root: string) =>
    result(async () => ({
      databases: await api<DatabaseMeta[]>("/api/databases"),
    })),
  databaseSync: (_root: string, id: string) =>
    result(() => command(id, "sync")),
  databaseGetRows: (_root: string, id: string) =>
    result(() => command(id, "sync")),
  databaseAddRow: (
    _root: string,
    id: string,
    values?: Record<string, unknown>,
  ) => result(() => command(id, "add-row", { values })),
  databaseInsertRow: (
    _root: string,
    id: string,
    referenceRowId: string,
    position: "above" | "below",
  ) => result(() => command(id, "insert-row", { referenceRowId, position })),
  databaseDeleteRow: (_root: string, id: string, rowId: string) =>
    result(() => command(id, "delete-row", { rowId })),
  databaseUpdateCell: (
    _root: string,
    id: string,
    rowId: string,
    key: string,
    value: unknown,
  ) => result(() => command(id, "cell", { rowId, key, value })),
  databaseUpdateSchema: (
    _root: string,
    id: string,
    schema: DatabaseColumnSchema[],
  ) => result(() => command(id, "schema", { schema })),
  databaseRenameRow: (_root: string, id: string, rowId: string, name: string) =>
    result(() => command(id, "rename-row", { rowId, name })),
  databaseReorderRows: (_root: string, id: string, rowIds: string[]) =>
    result(() => command(id, "reorder", { rowIds })),
  databaseSetActiveView: (_root: string, id: string, viewId: string) =>
    result(() => command(id, "active-view", { viewId })),
  databaseCreateView: (
    _root: string,
    id: string,
    type: DatabaseCustomViewType,
  ) => result(() => command(id, "create-view", { type })),
  databaseUpdateView: (_root:string,id:string,viewId:string,patch:{name?:string;config?:DatabaseViewConfig}) => {
    const current=useWorkspaceStore.getState().databases.find(d=>d.id===id)?.views.find(v=>v.id===viewId)?.config;
    const config=patch.config?Object.fromEntries(Object.entries(patch.config).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify((current as Record<string,unknown>|undefined)?.[key]))):undefined;
    return result(()=>command(id,'update-view',{viewId,...patch,...(config?{config}:{})}));
  },
  databaseDeleteView: (_root: string, id: string, viewId: string) =>
    result(() => command(id, "delete-view", { viewId })),
  databaseApplyKanbanDrop: (payload: DatabaseApplyKanbanDropRequest) =>
    result(() =>
      command(payload.databaseId, "kanban-drop", {
        rowMove: payload.rowMove,
        rowIds: payload.orderedRowIds,
      }),
    ),
  onDatabaseRowsChanged: (
    callback: (payload: { workspacePath: string; databaseId: string }) => void,
  ) => {
    const changed = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail?.path ?? "";
      const state = useWorkspaceStore.getState();
      for (const database of state.databases) {
        if (
          path.startsWith(database.folderPath + "/") ||
          path === database.folderPath ||
          path === ".maek/database.sqlite"
        )
          callback({
            workspacePath: state.rootPath ?? "",
            databaseId: database.id,
          });
      }
    };
    window.addEventListener("maek:workspace-change", changed);
    return () => window.removeEventListener("maek:workspace-change", changed);
  },
};
