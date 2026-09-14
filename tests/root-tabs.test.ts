import { describe, expect, it } from "vitest";
import path from "node:path";
import { readRootTabs, mergeRootTabs } from "../server/workspace/root-tabs";

const root = "/workspace";
const abs = (p: string) => path.join(root, p);

describe("root tabs document", () => {
  it("reads only web-supported file tabs as relative paths", () => {
    const document = {
      version: 4,
      tabs: [
        { id: abs("note.md"), viewKind: "editor" },
        { id: abs("db"), viewKind: "database" },
        { id: abs("meet"), viewKind: "meeting" },
        { id: abs("settings"), viewKind: "workspace-settings" },
        { id: "/outside/other.md", viewKind: "editor" },
        { id: abs("doc.pdf"), viewKind: "preview" },
      ],
      activeTabId: abs("note.md"),
    };
    expect(readRootTabs(root, document)).toEqual({
      tabs: ["note.md", "doc.pdf"],
      activeTabId: "note.md",
    });
  });

  it("drops an active tab that is not itself web-managed", () => {
    expect(
      readRootTabs(root, {
        tabs: [{ id: abs("note.md"), viewKind: "editor" }],
        activeTabId: abs("db"),
      }),
    ).toEqual({ tabs: ["note.md"], activeTabId: null });
  });

  it("returns an empty list for a document without a tabs array", () => {
    expect(readRootTabs(root, { version: 4 })).toEqual({
      tabs: [],
      activeTabId: null,
    });
  });

  it("merges web order while preserving desktop-only tabs, unknown fields, groups and splits", () => {
    const existing = {
      version: 4,
      tabs: [
        { id: abs("db"), viewKind: "database", pinned: true },
        { id: abs("a.md"), viewKind: "editor", scroll: 42 },
        { id: abs("b.md"), viewKind: "editor" },
      ],
      activeTabId: abs("a.md"),
      tabGroups: [{ id: "g1" }],
      editorSplit: { layout: "rows-2" },
      unknownTopLevel: "keep",
    };
    const merged = mergeRootTabs(root, existing, ["b.md", "a.md"], "b.md");
    expect(merged.version).toBe(4);
    expect(merged.tabGroups).toEqual(existing.tabGroups);
    expect(merged.editorSplit).toEqual(existing.editorSplit);
    expect(merged.unknownTopLevel).toBe("keep");
    expect(merged.activeTabId).toBe(abs("b.md"));
    expect(merged.tabs).toEqual([
      { id: abs("db"), viewKind: "database", pinned: true },
      // Reuses previous per-tab metadata for a.md.
      expect.objectContaining({ id: abs("b.md"), viewKind: "editor" }),
      expect.objectContaining({ id: abs("a.md"), scroll: 42 }),
    ]);
  });

  it("removes a web tab that is no longer open but keeps desktop-only tabs", () => {
    const existing = {
      version: 4,
      tabs: [
        { id: abs("db"), viewKind: "database" },
        { id: abs("a.md"), viewKind: "editor" },
        { id: abs("b.md"), viewKind: "editor" },
      ],
      activeTabId: abs("b.md"),
    };
    const merged = mergeRootTabs(root, existing, ["a.md"], "a.md");
    const ids = (merged.tabs as { id: string }[]).map((t) => t.id);
    expect(ids).toEqual([abs("db"), abs("a.md")]);
  });

  it("creates a fresh version-4 document when none exists", () => {
    const merged = mergeRootTabs(root, null, ["a.md"], "a.md");
    expect(merged).toMatchObject({
      version: 4,
      activeTabId: abs("a.md"),
    });
    expect((merged.tabs as { id: string }[])[0]!.id).toBe(abs("a.md"));
  });
});
