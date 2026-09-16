import { create } from "zustand";
import type { DatabaseMeta } from "@shared/database";
import { useStore } from "../../store";
export const useWorkspaceStore = create<{
  rootPath: string | null;
  databases: DatabaseMeta[];
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
  setDatabases: (databases) =>
    set((s) => ({
      databases: databases.map((d) => {
        const old = s.databases.find((o) => o.id === d.id);
        return old && JSON.stringify(old) === JSON.stringify(d) ? old : d;
      }),
    })),
  setFileOpenIntent: ({ fileId }) => {
    void useStore.getState().openFile(fileId);
  },
}));
