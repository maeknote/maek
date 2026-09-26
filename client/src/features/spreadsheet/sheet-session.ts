import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, registerEditBuffer } from "@renderer/features/workspace";
import type { UiState } from "@shared/workspace";
import { serializeCsv } from "./csv-codec";
import { cloneDocument, validateDocument, utf8ByteLength, CSV_LIMITS, type SpreadsheetDocument } from "./model";
import { parseCsvAsync } from "./worker-client";
import { CalcEngine } from "./calc-engine";
import { SheetHistory } from "./history";
import { runTransaction, type SheetCommand } from "./transaction";
import {
  singleSelection,
  type SelectionModel,
} from "./selection";
import {
  computeVisibleRows,
  isFiltered,
  type ColumnFilters,
} from "./filtering";
import { buildDisplayGrid, type DisplayCell } from "./display";
import { computeFillValues } from "./fill";
import { normalizeRange } from "./selection";

export type SheetViewSettings = NonNullable<UiState["spreadsheetViews"]>[string];

export interface DispatchResult {
  ok: boolean;
  noop?: boolean;
  reason?: string;
}

export interface SheetSession {
  document: SpreadsheetDocument | null;
  readonlyReason: string | null;
  warnings: string[];
  revision: number;
  /** Latest calculated display grid (formula results resolved). */
  display: DisplayCell[][];
  /** True while an async command is settling; blocks further doc mutations. */
  busy: boolean;
  calcError: string | null;

  selection: SelectionModel;
  setSelection: (selection: SelectionModel) => void;

  headerMode: boolean;
  filters: ColumnFilters;
  visibleRows: number[];
  filtered: boolean;

  view: SheetViewSettings;
  updateView: (patch: Partial<SheetViewSettings>) => void;

  dispatch: (command: SheetCommand, label?: string) => DispatchResult;
  /** Commit a pre-computed document (sort/cleanup) as one history entry. */
  dispatchDocument: (next: SpreadsheetDocument, label?: string) => DispatchResult;
  /** Fill the selection rectangle from its top row (down) or left column (right). */
  fill: (direction: "down" | "right") => DispatchResult;
  /** Record the last internal copy payload (raw + calculated values). */
  recordInternalCopy: (payload: { origin: { row: number; column: number }; values: string[][] } | null) => void;
  /** Paste the calculated values from the last internal copy at the active cell. */
  pasteValues: () => DispatchResult;
  /** Read the calculated value for a document cell (formula result or raw). */
  displayValue: (rowIdx: number, colIdx: number) => string;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  retryCalculation: () => void;
}

/**
 * The open-sheet session: owns the document, revision counter, undo history,
 * the persistent calculation engine, selection, and view settings. All document
 * mutations funnel through `dispatch`, which validates + serializes as one
 * transaction, records history, updates the workspace body, and requests a
 * recalculation. It registers a workspace edit buffer so save/close/copy flush
 * the in-progress body first.
 */
export function useSheetSession(tab: { id: string; bodyContent: string; editorSessionId: string; generation: number }): SheetSession {
  const updateBody = useStore((s) => s.updateBody);
  const setSpreadsheetView = useStore((s) => s.setSpreadsheetView);
  const storedView = useStore((s) => s.spreadsheetViews[tab.id]);

  const [document, setDocument] = useState<SpreadsheetDocument | null>(null);
  const [readonlyReason, setReadonlyReason] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [calculated, setCalculated] = useState<string[][]>([]);
  const [busy, setBusy] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionModel>(() => singleSelection({ rowIdx: 0, colIdx: 0 }));

  const documentRef = useRef<SpreadsheetDocument | null>(null);
  const historyRef = useRef(new SheetHistory());
  const engineRef = useRef<CalcEngine | null>(null);
  const revisionRef = useRef(0);
  const [historyTick, setHistoryTick] = useState(0);

  const view: SheetViewSettings = storedView ?? { headerMode: false };
  const headerMode = view.headerMode ?? false;
  const filters: ColumnFilters = useMemo(() => {
    const raw = view.filters ?? {};
    const parsed: ColumnFilters = {};
    for (const [key, value] of Object.entries(raw)) parsed[Number(key)] = value;
    return parsed;
  }, [view.filters]);

  // Keep a ref of the live document for the edit-buffer flush and engine calls.
  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  // Parse the CSV on mount / generation change; reset session state.
  useEffect(() => {
    let active = true;
    setDocument(null);
    setCalculated([]);
    historyRef.current.clear();
    revisionRef.current = 0;
    setRevision(0);
    void parseCsvAsync(tab.bodyContent)
      .then((result) => {
        if (!active) return;
        setDocument(result.document);
        documentRef.current = result.document;
        setReadonlyReason(result.readonlyReason);
        setWarnings(result.warnings);
        setSelection(singleSelection({ rowIdx: result.document.rows.length && (result.document.rows[0]?.id) ? 0 : 0, colIdx: 0 }));
      })
      .catch((error) => {
        if (active) setReadonlyReason(String(error));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.generation]);

  // Create the calculation engine for this session; dispose on unmount.
  useEffect(() => {
    const engine = new CalcEngine(tab.editorSessionId);
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [tab.editorSessionId]);

  // Recalculate whenever the document/revision changes.
  const requestCalculation = useCallback((doc: SpreadsheetDocument, rev: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    setCalcError(null);
    engine
      .calculate(doc, rev)
      .then((result) => {
        if (!engine.isNewer(result.revision)) return; // stale
        engine.markDelivered(result.revision);
        setCalculated(result.values);
      })
      .catch((error) => {
        setCalcError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(() => {
    if (!document) return;
    // Seed with raw values immediately so plain cells render before calc.
    setCalculated((current) => (current.length ? current : document.rows.map((row) => row.cells)));
    requestCalculation(document, revision);
  }, [document, revision, requestCalculation]);

  const displayValue = useCallback(
    (rowIdx: number, colIdx: number): string => {
      const raw = documentRef.current?.rows[rowIdx]?.cells[colIdx] ?? "";
      if (!raw.startsWith("=")) return raw;
      return calculated[rowIdx]?.[colIdx] ?? "";
    },
    [calculated],
  );

  const visibleRows = useMemo(() => {
    if (!document) return [];
    return computeVisibleRows({ document, filters, headerMode, getDisplayValue: displayValue });
  }, [document, filters, headerMode, displayValue]);

  const filtered = useMemo(() => isFiltered(filters), [filters]);

  const display = useMemo(() => {
    if (!document) return [];
    return buildDisplayGrid(document, calculated);
  }, [document, calculated]);

  const dispatch = useCallback(
    (command: SheetCommand, label?: string): DispatchResult => {
      const current = documentRef.current;
      if (!current || readonlyReason || busy) return { ok: false, reason: readonlyReason ?? "Sheet is busy" };
      const result = runTransaction(current, command);
      if (!result.ok) return { ok: false, reason: result.reason };
      if (result.noop) return { ok: true, noop: true };
      historyRef.current.push({ before: current, after: result.next, label });
      const nextRevision = revisionRef.current + 1;
      revisionRef.current = nextRevision;
      documentRef.current = result.next;
      setDocument(result.next);
      setRevision(nextRevision);
      updateBody(tab.id, result.serialized);
      setHistoryTick((t) => t + 1);
      return { ok: true };
    },
    [readonlyReason, busy, tab.id, updateBody],
  );

  const applyDocument = useCallback(
    (next: SpreadsheetDocument) => {
      const nextRevision = revisionRef.current + 1;
      revisionRef.current = nextRevision;
      documentRef.current = next;
      setDocument(next);
      setRevision(nextRevision);
      updateBody(tab.id, serializeCsv(next));
      setHistoryTick((t) => t + 1);
    },
    [tab.id, updateBody],
  );

  const dispatchDocument = useCallback(
    (next: SpreadsheetDocument, label?: string): DispatchResult => {
      const current = documentRef.current;
      if (!current || readonlyReason || busy) return { ok: false, reason: readonlyReason ?? "Sheet is busy" };
      if (next === current) return { ok: true, noop: true };
      const shapeError = validateDocument(next);
      if (shapeError) return { ok: false, reason: shapeError };
      const serialized = serializeCsv(next);
      if (utf8ByteLength(serialized) > CSV_LIMITS.bytes) return { ok: false, reason: "CSV files must be 5 MiB or smaller" };
      historyRef.current.push({ before: current, after: next, label });
      const nextRevision = revisionRef.current + 1;
      revisionRef.current = nextRevision;
      documentRef.current = next;
      setDocument(next);
      setRevision(nextRevision);
      updateBody(tab.id, serialized);
      setHistoryTick((t) => t + 1);
      return { ok: true };
    },
    [readonlyReason, busy, tab.id, updateBody],
  );

  const fill = useCallback(
    (direction: "down" | "right"): DispatchResult => {
      const current = documentRef.current;
      if (!current) return { ok: false, reason: "No document" };
      const range = normalizeRange(selection.ranges[selection.ranges.length - 1] ?? { anchor: selection.activeCell, focus: selection.activeCell });
      if (direction === "down") {
        if (range.bottom <= range.top) return { ok: true, noop: true };
        // Each column filled independently from its single seed (top cell).
        const matrix: string[][] = [];
        for (let r = range.top + 1; r <= range.bottom; r++) matrix.push([]);
        for (let c = range.left; c <= range.right; c++) {
          const seed = current.rows[range.top]?.cells[c] ?? "";
          const filled = computeFillValues({
            seeds: [seed],
            count: range.bottom - range.top,
            offsetFor: (index) => ({ row: index + 1, column: 0 }),
          });
          filled.forEach((value, index) => {
            matrix[index]![c - range.left] = value;
          });
        }
        return dispatch({ type: "paste", start: { rowIdx: range.top + 1, colIdx: range.left }, matrix }, "Fill down");
      }
      if (range.right <= range.left) return { ok: true, noop: true };
      const matrix: string[][] = [];
      for (let r = range.top; r <= range.bottom; r++) {
        const seed = current.rows[r]?.cells[range.left] ?? "";
        const filled = computeFillValues({
          seeds: [seed],
          count: range.right - range.left,
          offsetFor: (index) => ({ row: 0, column: index + 1 }),
        });
        matrix.push(filled);
      }
      return dispatch({ type: "paste", start: { rowIdx: range.top, colIdx: range.left + 1 }, matrix }, "Fill right");
    },
    [selection, dispatch],
  );

  const internalCopyRef = useRef<{ origin: { row: number; column: number }; values: string[][] } | null>(null);
  const recordInternalCopy = useCallback((payload: { origin: { row: number; column: number }; values: string[][] } | null) => {
    internalCopyRef.current = payload;
  }, []);
  const pasteValues = useCallback((): DispatchResult => {
    const payload = internalCopyRef.current;
    if (!payload) return { ok: false, reason: "Nothing to paste" };
    const range = normalizeRange(selection.ranges[selection.ranges.length - 1] ?? { anchor: selection.activeCell, focus: selection.activeCell });
    // Value-only: inserts calculated results as plain strings, no formulas.
    return dispatch({ type: "paste", start: { rowIdx: range.top, colIdx: range.left }, matrix: payload.values }, "Paste values");
  }, [selection, dispatch]);

  const undo = useCallback(() => {
    if (readonlyReason) return;
    const entry = historyRef.current.undo();
    if (!entry) return;
    applyDocument(cloneDocument(entry.before));
  }, [readonlyReason, applyDocument]);

  const redo = useCallback(() => {
    if (readonlyReason) return;
    const entry = historyRef.current.redo();
    if (!entry) return;
    applyDocument(cloneDocument(entry.after));
  }, [readonlyReason, applyDocument]);

  const updateView = useCallback(
    (patch: Partial<SheetViewSettings>) => {
      setSpreadsheetView(tab.id, patch);
    },
    [setSpreadsheetView, tab.id],
  );

  const retryCalculation = useCallback(() => {
    if (documentRef.current) requestCalculation(documentRef.current, revisionRef.current);
  }, [requestCalculation]);

  // Register an edit buffer so the workspace can flush the current body before
  // saving/closing/copying. The spreadsheet commits synchronously into the
  // store via dispatch, so flush is a no-op unless a component has queued work;
  // the buffer still lets the store know pending state via hasPending.
  const pendingRef = useRef(false);
  useEffect(() => {
    const unregister = registerEditBuffer(tab.editorSessionId, {
      flush: async () => {
        // The active cell/formula editor confirms into the store synchronously
        // on blur; nothing async remains here. Reserved for future queued work.
        pendingRef.current = false;
      },
      discard: () => {
        pendingRef.current = false;
      },
      hasPending: () => pendingRef.current,
    });
    return unregister;
  }, [tab.editorSessionId]);

  // canUndo/canRedo are read from the history ref at render time; historyTick
  // forces a re-render whenever the history changes so they stay fresh.
  void historyTick;
  void setBusy;

  return {
    document,
    readonlyReason,
    warnings,
    revision,
    display,
    busy,
    calcError,
    selection,
    setSelection,
    headerMode,
    filters,
    visibleRows,
    filtered,
    view,
    updateView,
    dispatch,
    dispatchDocument,
    fill,
    recordInternalCopy,
    pasteValues,
    displayValue,
    undo,
    redo,
    canUndo: historyRef.current.canUndo,
    canRedo: historyRef.current.canRedo,
    retryCalculation,
  };
}
