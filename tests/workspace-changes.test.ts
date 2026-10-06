import { describe, expect, it } from "vitest";
import { applyTreeChanges, WorkspaceChangeBatch } from "../shared/workspace-changes";
import type { Change, FileNode } from "../shared/workspace";
import { affectsDatabaseRegistry, affectsDatabaseRows } from "../client/src/features/database/changeImpact";
import { ExplorerTreeIndex } from "../client/src/features/explorer/utils/treeIndex";

const node = (id: string, isDir = false): FileNode => ({
  id, name: id.split("/").at(-1)!, parent: id.split("/").slice(0, -1).join("/") || null, isDir,
});
const add = (id: string, isDir = false): Change => ({ type: isDir ? "addDir" : "add", path: id, node: node(id, isDir) });

describe("workspace change scope and batching", () => {
  it("does not invalidate DB discovery or rows for 1,000 unrelated image additions", () => {
    const databases = [{ folderPath: "Board" }];
    for (let index = 0; index < 1000; index++) {
      const change = add(`experiments/${index}.png`);
      expect(affectsDatabaseRegistry(change, databases)).toBe(false);
      expect(affectsDatabaseRows(change, "Board")).toBe(false);
    }
    expect(affectsDatabaseRegistry(add("empty", true), databases)).toBe(false);
    expect(affectsDatabaseRegistry({ type: "rename", source: "a.md", path: "b.md" }, databases)).toBe(false);
  });

  it("updates registry metadata independently from row data and accounts for both rename paths", () => {
    const manifest = add("Board/.maek-database.json");
    expect(affectsDatabaseRegistry(manifest, [])).toBe(true);
    expect(affectsDatabaseRows(manifest, "Board")).toBe(false);
    const row: Change = { type: "change", path: "Board/Task.md" };
    expect(affectsDatabaseRegistry(row, [{ folderPath: "Board" }])).toBe(false);
    expect(affectsDatabaseRows(row, "Board")).toBe(true);
    expect(affectsDatabaseRows(row, "Other")).toBe(false);
    expect(affectsDatabaseRows(add("Board/sub/Task.md"), "Board")).toBe(false);
    expect(affectsDatabaseRows(add("Task.md"), "")).toBe(true);
    expect(affectsDatabaseRows(add("sub/Task.md"), "")).toBe(false);
    const moved: Change = { type: "rename", source: "Projects", path: "Moved" };
    expect(affectsDatabaseRegistry(moved, [{ folderPath: "Projects/Board" }])).toBe(true);
    expect(affectsDatabaseRegistry(moved, [{ folderPath: "Moved/Board" }])).toBe(true);
    expect(affectsDatabaseRows(moved, "Projects/Board")).toBe(true);
  });

  it("coalesces writes but preserves delete/recreate and rename barriers", () => {
    const batch = new WorkspaceChangeBatch();
    for (let i = 0; i < 1000; i++) batch.add({ type: "change", path: "note.md" });
    expect(batch.size).toBe(1);
    batch.add({ type: "unlink", path: "note.md" });
    batch.add(add("note.md"));
    batch.add({ type: "change", path: "note.md" });
    expect(batch.take().map(change => change.type)).toEqual(["change", "unlink", "add", "change"]);
    expect(batch.size).toBe(0);
  });

  it("preserves unchanged references and applies directory operations in order", () => {
    const untouched = node("other.md");
    const nodes = [node("Folder", true), node("Folder/old.md"), untouched];
    expect(applyTreeChanges(nodes, [{ type: "change", path: "other.md" }])).toBe(nodes);
    const updated = applyTreeChanges(nodes, [
      { type: "unlinkDir", path: "Folder" }, add("Folder", true), add("Folder/new.md"),
      { type: "rename", source: "Folder", path: "Moved", node: node("Moved", true) },
    ]);
    expect(updated.map(item => item.id)).toEqual(["Moved", "Moved/new.md", "other.md"]);
    expect(updated.find(item => item.id === "other.md")).toBe(untouched);
    expect(applyTreeChanges(updated, [add("other.md")])).toBe(updated);
  });

  it("handles renames crossing a snapshot's hidden path boundary", () => {
    const includePath = (path: string) => !path.endsWith(".maek-database.json");
    const nodes = [node("other.md")];
    expect(applyTreeChanges(nodes, [add("Board/.maek-database.json")], includePath)).toBe(nodes);
    const visible = applyTreeChanges(nodes, [{
      type: "rename", source: "Board/.maek-database.json", path: "backup.json", node: node("backup.json"),
    }], includePath);
    expect(visible.map(item => item.id)).toEqual(["backup.json", "other.md"]);
    const hidden = applyTreeChanges(visible, [{
      type: "rename", source: "backup.json", path: "Board/.maek-database.json", node: node("Board/.maek-database.json"),
    }], includePath);
    expect(hidden).toEqual(nodes);
    expect(hidden[0]).toBe(nodes[0]);
  });
});

describe("explorer tree references", () => {
  it("reuses unaffected branches and does not rebuild for DB view configuration changes", () => {
    const index = new ExplorerTreeIndex();
    const initial = [node("A", true), node("B", true), node("A/a.md"), node("B/b.md")];
    const tree = index.build(initial, new Map(), false);
    expect(index.build(initial, new Map(), false)).toBe(tree);
    const updated = applyTreeChanges(initial, [add("A/new.md")]);
    const next = index.build(updated, new Map(), false);
    expect(next[0]).not.toBe(tree[0]);
    expect(next[1]).toBe(tree[1]);
    expect(next[0]?.children?.[0]).toBe(tree[0]?.children?.[0]);
    expect(index.build(updated, new Map([["A", "Board"]]), false)[0]?.children).toBeUndefined();
    expect(index.build(updated, new Map(), false)[0]?.children).toHaveLength(2);
  });

  it("honors hidden ancestors and removes orphaned/deleted branches", () => {
    const index = new ExplorerTreeIndex();
    const nodes = [node(".hidden", true), node(".hidden/note.md"), node("plain.md"), node("missing/orphan.md")];
    expect(index.build(nodes, new Map(), false).map(item => item.id)).toEqual(["plain.md"]);
    expect(index.build(nodes, new Map(), true).map(item => item.id)).toEqual([".hidden", "plain.md"]);
    expect(index.build([], new Map(), true)).toEqual([]);
  });
});
