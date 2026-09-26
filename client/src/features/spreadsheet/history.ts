import { cloneDocument, type SpreadsheetDocument } from "./model";

/** Maximum number of undo entries retained (mirrors the previous UI limit). */
export const HISTORY_MAX_ENTRIES = 100;
/** Estimated in-memory budget for the combined undo + redo history. */
export const HISTORY_MAX_BYTES = 20 * 1024 * 1024;

/**
 * A single reversible change. The document snapshots are the minimum needed to
 * step backward/forward; view-setting deltas capture structural side effects
 * (e.g. frozen boundaries shifting when a column is inserted) so undo can
 * reverse only what the command changed without clobbering later user tweaks.
 */
export interface HistoryEntry {
  readonly before: SpreadsheetDocument;
  readonly after: SpreadsheetDocument;
  /** View-setting patch applied by the command, if any (reversible). */
  readonly viewBefore?: Record<string, unknown>;
  readonly viewAfter?: Record<string, unknown>;
  /** Human-readable command label, useful for debugging/telemetry. */
  readonly label?: string;
}

export function estimateDocumentBytes(document: SpreadsheetDocument): number {
  let bytes = 0;
  for (const row of document.rows) {
    bytes += 48;
    for (const cell of row.cells) bytes += cell.length * 2 + 8;
  }
  return bytes;
}

function estimateEntryBytes(entry: HistoryEntry): number {
  return estimateDocumentBytes(entry.before) + estimateDocumentBytes(entry.after);
}

/**
 * Command-scoped undo/redo history. Each push is one user-visible command
 * (paste, fill, sort, cleanup, single edit). Undo and redo return the entry so
 * the session can also reverse/replay any view-setting deltas.
 */
export class SheetHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private bytes = 0;

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get size(): number {
    return this.past.length;
  }

  push(entry: HistoryEntry): void {
    // Store defensive clones so later document mutations cannot corrupt history.
    const stored: HistoryEntry = {
      before: cloneDocument(entry.before),
      after: cloneDocument(entry.after),
      viewBefore: entry.viewBefore,
      viewAfter: entry.viewAfter,
      label: entry.label,
    };
    this.past.push(stored);
    this.bytes += estimateEntryBytes(stored);
    // Any new command invalidates the redo stack.
    for (const dropped of this.future) this.bytes -= estimateEntryBytes(dropped);
    this.future = [];
    this.trim();
  }

  undo(): HistoryEntry | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.future.push(entry);
    return entry;
  }

  redo(): HistoryEntry | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry);
    return entry;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.bytes = 0;
  }

  private trim(): void {
    while (
      (this.past.length > HISTORY_MAX_ENTRIES || this.bytes > HISTORY_MAX_BYTES) &&
      this.past.length > 1
    ) {
      const removed = this.past.shift();
      if (removed) this.bytes -= estimateEntryBytes(removed);
    }
  }
}
