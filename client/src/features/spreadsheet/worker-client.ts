import { parseCsv, type CsvParseResult } from "./csv-codec";

let requestId = 0;

export function parseCsvAsync(content: string): Promise<CsvParseResult> {
  if (typeof Worker === "undefined") return Promise.resolve(parseCsv(content));
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const worker = new Worker(new URL("./csv.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; result?: CsvParseResult; error?: string }>) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "CSV parser failed"));
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ id, content });
  });
}
