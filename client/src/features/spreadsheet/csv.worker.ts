/// <reference lib="webworker" />
import { parseCsv } from "./csv-codec";

self.onmessage = (event: MessageEvent<{ id: number; content: string }>) => {
  try {
    self.postMessage({ id: event.data.id, result: parseCsv(event.data.content) });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : String(error) });
  }
};

export {};
