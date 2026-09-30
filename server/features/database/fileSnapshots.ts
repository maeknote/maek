import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { sha256, flooredMtime } from "../../core/fs/readFile";
import { parseYamlData, splitFrontmatterFile } from "../../../shared/frontmatter";

interface Snapshot {
  fingerprint: string;
  hash: string;
  mtime: number;
  yaml: Record<string, unknown>;
}

/** Runtime-only parsed snapshots. Conflict-sensitive writes still read the file. */
export class DatabaseFileSnapshots {
  private files = new Map<string, Snapshot>();
  readonly metrics = { reads: 0, hits: 0 };

  async get(absolutePath: string): Promise<Snapshot> {
    const info = await stat(absolutePath, { bigint: true });
    const fingerprint = [info.mtimeNs, info.ctimeNs, info.size, info.ino, info.dev].join(":");
    const cached = this.files.get(absolutePath);
    if (cached?.fingerprint === fingerprint) {
      this.metrics.hits++;
      return cached;
    }
    const buffer = await readFile(absolutePath);
    this.metrics.reads++;
    const snapshot = {
      fingerprint, hash: sha256(buffer), mtime: flooredMtime(Number(info.mtimeNs) / 1e6),
      yaml: parseYamlData(splitFrontmatterFile(buffer.toString("utf8")).frontmatterRaw),
    };
    this.files.set(absolutePath, snapshot);
    return snapshot;
  }

  retain(folder: string, paths: Set<string>) {
    for (const key of this.files.keys()) {
      if (path.dirname(key) === folder && !paths.has(key)) this.files.delete(key);
    }
  }
}
