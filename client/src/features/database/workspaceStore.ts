import { create } from "zustand";
import type { DatabaseMeta } from "@shared/database";
import { useStore } from "@renderer/features/workspace";
function withActiveView(database: DatabaseMeta, viewId: string): DatabaseMeta {
  const view = database.views.find(view => view.id === viewId);
  return view ? { ...database, activeViewId: viewId, viewType: view.type,
    viewConfig: { type: view.type, config: view.config } as DatabaseMeta["viewConfig"] } : database;
}
export const useWorkspaceStore = create<{
  rootPath: string | null;
  databases: DatabaseMeta[];
  pendingViewIds: Record<string, string>;
  setPendingView: (databaseId: string, viewId: string | null) => void;
  setDatabases: (databases: DatabaseMeta[]) => void;
  setFileOpenIntent: (intent: {
    fileId: string;
    fileName: string;
    parentName: string;
    mode: string;
    kind: string;
  }) => void;
}>((set) => ({
  rootPath: null,
  databases: [],
  pendingViewIds: {},
  setPendingView: (databaseId, viewId) => set(state => {
    const pendingViewIds = { ...state.pendingViewIds };
    if (viewId === null) delete pendingViewIds[databaseId];
    else pendingViewIds[databaseId] = viewId;
    return { pendingViewIds, databases: state.databases.map(database =>
      database.id === databaseId && viewId !== null ? withActiveView(database, viewId) : database) };
  }),
  setDatabases: (databases) =>
    set((s) => ({
      databases: databases.map((saved) => {
        const pendingView = s.pendingViewIds[saved.id];
        const d = pendingView && saved.views.some(view => view.id === pendingView)
          ? withActiveView(saved, pendingView) : withActiveView(saved, saved.activeViewId);
        const old = s.databases.find((o) => o.id === d.id);
        return old && JSON.stringify(old) === JSON.stringify(d) ? old : d;
      }),
    })),
  setFileOpenIntent: ({ fileId }) => {
    void useStore.getState().openFile(fileId);
  },
}));
