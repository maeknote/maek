import { create } from "zustand";
import { api } from "@renderer/shared/api";
import type { ExplorerSettingsData } from "@shared/workspace-settings";

interface ExplorerSettingsState {
  /** Whether dot-prefixed files and folders are shown in the file tree. */
  showHiddenFiles: boolean;
  isLoaded: boolean;
  /** Fetch the current workspace's explorer settings from the server. */
  load: () => Promise<void>;
  /** Seed the store from a dashboard payload without a round trip. */
  hydrate: (settings: ExplorerSettingsData) => void;
  /** Update the toggle, apply it immediately, and persist to the workspace. */
  setShowHiddenFiles: (value: boolean) => Promise<void>;
}

export const useExplorerSettings = create<ExplorerSettingsState>((set, get) => ({
  showHiddenFiles: false,
  isLoaded: false,
  hydrate: (settings) =>
    set({ showHiddenFiles: !!settings.showHiddenFiles, isLoaded: true }),
  load: async () => {
    try {
      const data = await api<ExplorerSettingsData>(
        "/api/workspace/explorer-settings",
      );
      set({ showHiddenFiles: !!data.showHiddenFiles, isLoaded: true });
    } catch (e) {
      console.error("Failed to load explorer settings", e);
      set({ showHiddenFiles: false, isLoaded: true });
    }
  },
  setShowHiddenFiles: async (value: boolean) => {
    const previous = get().showHiddenFiles;
    if (previous === value) return;
    set({ showHiddenFiles: value });
    try {
      await api("/api/workspace/explorer-settings", "PUT", {
        version: 1,
        showHiddenFiles: value,
      });
    } catch (e) {
      console.error("Failed to save explorer settings", e);
      set({ showHiddenFiles: previous });
    }
  },
}));

// Cross-browser sync: the server watches `.maek/explorer-settings.json` and
// emits a workspace-change event when another browser (or the desktop app)
// rewrites it. Reload so this tab's tree reflects the shared value.
window.addEventListener("maek:workspace-change", (event) => {
  if (
    (event as CustomEvent<{ path: string }>).detail?.path ===
    ".maek/explorer-settings.json"
  )
    void useExplorerSettings.getState().load();
});
