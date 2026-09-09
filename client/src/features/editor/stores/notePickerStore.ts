import { create } from "zustand";
import type { FileNode } from "@shared/types";

interface NotePickerState {
  isOpen: boolean;
  position: { x: number; y: number };
  onSelect: ((file: FileNode) => void) | null;
  open: (
    position: { x: number; y: number },
    onSelect: (file: FileNode) => void,
  ) => void;
  close: () => void;
}

export const useNotePickerStore = create<NotePickerState>((set) => ({
  isOpen: false,
  position: { x: 0, y: 0 },
  onSelect: null,
  open: (position, onSelect) => set({ isOpen: true, position, onSelect }),
  close: () => set({ isOpen: false, onSelect: null }),
}));
