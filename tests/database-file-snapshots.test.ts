import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseFileSnapshots } from "../server/features/database/fileSnapshots";
import { sha256 } from "../server/core/fs/readFile";

describe("database file snapshots", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "maek-db-cache-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("reuses unchanged YAML and hashes and detects same-size edits with restored mtime", async () => {
    const file = path.join(root, "note.md");
    await writeFile(file, "---\nstatus: Todo\n---\nBody");
    const cache = new DatabaseFileSnapshots();
    const original = await cache.get(file);
    expect(await cache.get(file)).toBe(original);
    expect(cache.metrics).toEqual({ reads: 1, hits: 1 });
    const info = await stat(file);
    await writeFile(file, "---\nstatus: Done\n---\nBody");
    await utimes(file, info.atime, info.mtime);
    const changed = await cache.get(file);
    expect(changed.yaml).toEqual({ status: "Done" });
    expect(changed.hash).toBe(sha256(await readFile(file)));
    expect(changed.hash).not.toBe(original.hash);
    expect(cache.metrics.reads).toBe(2);
  });

  it("evicts removed files so a replacement is read again", async () => {
    const file = path.join(root, "note.md");
    await writeFile(file, "---\nstatus: Todo\n---");
    const cache = new DatabaseFileSnapshots();
    await cache.get(file);
    cache.retain(root, new Set());
    await cache.get(file);
    expect(cache.metrics.reads).toBe(2);
  });
});
