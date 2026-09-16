import { create } from "zustand";
import { api } from "../../../host";
import type { FolderAppearance } from "../utils/folderAppearance";

export interface FolderAppearanceData {
  version: number;
  folders: Record<string, FolderAppearance>;
}

interface FolderAppearanceState {
  appearances: Record<string, FolderAppearance>;
  isLoaded: boolean;
  load: () => Promise<void>;
  setAppearance: (
    folderPath: string,
    appearance: FolderAppearance | null,
  ) => Promise<void>;
}

export const useFolderAppearance = create<FolderAppearanceState>((set, get) => ({
  appearances: {},
  isLoaded: false,
  load: async () => {
    try {
      const data = await api<FolderAppearanceData>(
        "/api/workspace/folder-appearance",
      );
      set({ appearances: data.folders || {}, isLoaded: true });
    } catch (e) {
      console.error("Failed to load folder appearance", e);
      set({ appearances: {}, isLoaded: true });
    }
  },
  setAppearance: async (
    folderPath: string,
    appearance: FolderAppearance | null,
  ) => {
    const current = { ...get().appearances };
    if (appearance) {
      current[folderPath] = appearance;
    } else {
      delete current[folderPath];
    }
    set({ appearances: current });
    try {
      await api("/api/workspace/folder-appearance", "PUT", {
        version: 1,
        folders: current,
      });
    } catch (e) {
      console.error("Failed to save folder appearance", e);
    }
  },
}));

window.addEventListener('maek:workspace-change',(event)=>{if((event as CustomEvent<{path:string}>).detail?.path==='.maek/folder-appearance.json')void useFolderAppearance.getState().load()});
