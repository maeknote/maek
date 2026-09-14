import { create } from "zustand";
import { api } from "../../../host";

interface FolderAppearanceState {
  appearances: Record<string, string>;
  isLoaded: boolean;
  load: () => Promise<void>;
  setAppearance: (folderPath: string, emoji: string | null) => Promise<void>;
}

export const useFolderAppearance = create<FolderAppearanceState>((set, get) => ({
  appearances: {},
  isLoaded: false,
  load: async () => {
    try {
      const data = await api<Record<string, string>>("/api/workspace/folder-appearance");
      set({ appearances: data, isLoaded: true });
    } catch (e) {
      console.error("Failed to load folder appearance", e);
      set({ appearances: {}, isLoaded: true });
    }
  },
  setAppearance: async (folderPath: string, emoji: string | null) => {
    const current = { ...get().appearances };
    if (emoji) {
      current[folderPath] = emoji;
    } else {
      delete current[folderPath];
    }
    set({ appearances: current });
    try {
      await api("/api/workspace/folder-appearance", "PUT", current);
    } catch (e) {
      console.error("Failed to save folder appearance", e);
    }
  },
}));
