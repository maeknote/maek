import { create } from "zustand";

interface ImageResizeState {
  sizes: Record<string, number>;
  setSize: (key: string, widthPercent: number) => void;
}

export const useImageResizeStore = create<ImageResizeState>((set) => ({
  sizes: {},
  setSize: (key, widthPercent) =>
    set((state) => ({ sizes: { ...state.sizes, [key]: widthPercent } })),
}));
