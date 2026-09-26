import { calculateCells } from "./formulas";
import type { SpreadsheetDocument } from "./model";

/**
 * Persistent calculation client for one open sheet session.
 *
 * Instead of spawning a fresh Worker per edit, a session keeps one worker (and
 * one HyperFormula instance inside it) alive. Requests carry a monotonically
 * increasing revision so late responses for stale revisions can be dropped and
 * never overwrite a newer screen.
 *
 * The worker is created lazily and torn down on dispose(). In environments
 * without Worker support (tests, SSR) it falls back to synchronous in-process
 * calculation.
 */

export interface CalcResult {
  revision: number;
  values: string[][];
}

interface PendingRequest {
  revision: number;
  resolve: (result: CalcResult) => void;
  reject: (error: Error) => void;
}

export class CalcEngine {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private pending = new Map<number, PendingRequest>();
  private disposed = false;
  /** Highest revision for which a result has been delivered to the caller. */
  private deliveredRevision = -1;

  constructor(private readonly sessionId: string) {}

  private ensureWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./formulas.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; sessionId: string; revision: number; result?: string[][]; error?: string }>) => {
      const { id, result, error } = event.data;
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (error) {
        request.reject(new Error(error));
        return;
      }
      request.resolve({ revision: request.revision, values: result ?? [] });
    };
    worker.onerror = (event) => {
      // Fail all in-flight requests; the session surfaces the error and can retry.
      for (const request of this.pending.values()) request.reject(new Error(event.message || "Formula worker failed"));
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  /**
   * Request calculation for a document at a given revision. Resolves with the
   * result tagged by revision; the caller must ignore results whose revision is
   * older than the latest it has applied.
   */
  async calculate(document: SpreadsheetDocument, revision: number): Promise<CalcResult> {
    if (this.disposed) return { revision, values: document.rows.map((row) => row.cells) };
    const worker = this.ensureWorker();
    if (!worker) {
      // Synchronous fallback.
      return { revision, values: calculateCells(document) };
    }
    const id = ++this.nextRequestId;
    return new Promise<CalcResult>((resolve, reject) => {
      this.pending.set(id, { revision, resolve, reject });
      worker.postMessage({ id, sessionId: this.sessionId, revision, document });
    });
  }

  /** Whether a revision is newer than the last one the caller applied. */
  isNewer(revision: number): boolean {
    return revision > this.deliveredRevision;
  }

  /** Record that the caller applied a result for this revision. */
  markDelivered(revision: number): void {
    if (revision > this.deliveredRevision) this.deliveredRevision = revision;
  }

  dispose(): void {
    this.disposed = true;
    for (const request of this.pending.values()) request.reject(new Error("Calculation engine disposed"));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
}
