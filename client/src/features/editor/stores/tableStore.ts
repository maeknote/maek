import { create } from "zustand";

export type TableMenuAction =
  | "addRowAbove"
  | "addRowBelow"
  | "deleteRow"
  | "addColumnLeft"
  | "addColumnRight"
  | "deleteColumn";

export type MenuType = "row" | "column";

interface TableState {
  // Menu state
  menuOpen: boolean;
  menuType: MenuType | null;
  menuPosition: { x: number; y: number } | null;
  menuTargetIndex: number | null;
  activeTablePos: number | null;

  // Grip visibility state (shown on double-click)
  gripsVisible: boolean;
  gripsTablePos: number | null;
  gripsRowIndex: number | null;
  gripsColIndex: number | null;

  // Hover state for grips (legacy, may remove later)
  hoveredRowIndex: number | null;
  hoveredColumnIndex: number | null;

  // Actions
  openMenu: (
    type: MenuType,
    index: number,
    position: { x: number; y: number },
    tablePos: number,
  ) => void;
  closeMenu: () => void;

  showGrips: (tablePos: number, rowIndex: number, colIndex: number) => void;
  hideGrips: () => void;

  setHoveredRow: (index: number | null) => void;
  setHoveredColumn: (index: number | null) => void;

  reset: () => void;
}

const initialState = {
  menuOpen: false,
  menuType: null,
  menuPosition: null,
  menuTargetIndex: null,
  activeTablePos: null,
  gripsVisible: false,
  gripsTablePos: null,
  gripsRowIndex: null,
  gripsColIndex: null,
  hoveredRowIndex: null,
  hoveredColumnIndex: null,
};

export const useTableStore = create<TableState>()((set) => ({
  ...initialState,

  openMenu: (type, index, position, tablePos) =>
    set({
      menuOpen: true,
      menuType: type,
      menuTargetIndex: index,
      menuPosition: position,
      activeTablePos: tablePos,
    }),

  closeMenu: () =>
    set({
      menuOpen: false,
      menuType: null,
      menuTargetIndex: null,
      menuPosition: null,
    }),

  showGrips: (tablePos, rowIndex, colIndex) =>
    set({
      gripsVisible: true,
      gripsTablePos: tablePos,
      gripsRowIndex: rowIndex,
      gripsColIndex: colIndex,
    }),

  hideGrips: () =>
    set({
      gripsVisible: false,
      gripsTablePos: null,
      gripsRowIndex: null,
      gripsColIndex: null,
    }),

  setHoveredRow: (index) => set({ hoveredRowIndex: index }),
  setHoveredColumn: (index) => set({ hoveredColumnIndex: index }),

  reset: () => set(initialState),
}));
