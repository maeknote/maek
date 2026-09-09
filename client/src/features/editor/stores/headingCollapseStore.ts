import { create } from "zustand";

interface HeadingCollapseState {
  collapsedByTab: Record<string, string[]>;
  setCollapsed: (tabId: string, keys: string[]) => void;
  getCollapsed: (tabId: string) => string[];
  clearTab: (tabId: string) => void;
  renameTab: (oldId: string, newId: string) => void;
}

export const useHeadingCollapseStore = create<HeadingCollapseState>(
  (set, get) => ({
    collapsedByTab: {},

    setCollapsed: (tabId, keys) => {
      set((state) => ({
        collapsedByTab: { ...state.collapsedByTab, [tabId]: keys },
      }));
    },

    getCollapsed: (tabId) => {
      return get().collapsedByTab[tabId] ?? [];
    },

    clearTab: (tabId) => {
      set((state) => {
        const { [tabId]: _, ...rest } = state.collapsedByTab;
        return { collapsedByTab: rest };
      });
    },

    renameTab: (oldId, newId) => {
      set((state) => {
        if (!Object.prototype.hasOwnProperty.call(state.collapsedByTab, oldId))
          return state;
        const { [oldId]: keys, ...rest } = state.collapsedByTab;
        return { collapsedByTab: { ...rest, [newId]: keys! } };
      });
    },
  }),
);
