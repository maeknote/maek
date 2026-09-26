/// <reference lib="webworker" />
import { calculateCells } from "./formulas";
import type { SpreadsheetDocument } from "./model";

interface CalcRequest {
  id: number;
  sessionId?: string;
  revision?: number;
  document: SpreadsheetDocument;
}

self.onmessage = (event: MessageEvent<CalcRequest>) => {
  const { id, sessionId, revision, document } = event.data;
  try {
    self.postMessage({ id, sessionId, revision, result: calculateCells(document) });
  } catch (error) {
    self.postMessage({ id, sessionId, revision, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
