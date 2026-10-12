import { describe, expect, it } from "vitest";
import type { ViewGroup } from "../shared/workspace";
import {
  groupForTab,
  groupsFromUi,
  normalizeViewGroups,
} from "../client/src/features/workspace/model/viewGroups";

const single = (id: string, tabId: string): ViewGroup => ({ id, kind: "single", tabId });
const split = (id: string, left: string, right: string): ViewGroup => ({
  id, kind: "split", left, right, active: "left", ratio: 0.5,
});

describe("view groups: a file may belong to several Open Tabs entries", () => {
  it("restores a file's own entry next to a split that also shows it", () => {
    const stored = [single("a", "a.pdf"), split("s", "b.pdf", "a.pdf")];
    expect(groupsFromUi(["a.pdf", "b.pdf"], { viewGroups: stored })).toEqual(stored);
  });

  it("adds an entry only for open files that no group shows", () => {
    const groups = groupsFromUi(["a.pdf", "b.pdf", "c.md"], {
      viewGroups: [split("s", "b.pdf", "a.pdf")],
    });
    expect(groups).toHaveLength(2);
    expect(groups[1]).toMatchObject({ kind: "single", tabId: "c.md" });
  });

  it("shrinks a split whose other file closed, without duplicating an entry", () => {
    const groups = [single("a", "a.pdf"), split("s", "b.pdf", "a.pdf")];
    expect(normalizeViewGroups(groups, new Set(["a.pdf"]))).toEqual([single("a", "a.pdf")]);
    expect(normalizeViewGroups(groups, new Set(["a.pdf"]), "s")).toEqual([single("s", "a.pdf")]);
    expect(normalizeViewGroups(groups, new Set(["b.pdf"]))).toEqual([single("s", "b.pdf")]);
  });

  it("never keeps the same file in both panes of one split", () => {
    expect(normalizeViewGroups([split("s", "a.pdf", "a.pdf")], new Set(["a.pdf"])))
      .toEqual([single("s", "a.pdf")]);
  });

  it("migrates a v1 split when no v2 layout was stored", () => {
    const groups = groupsFromUi(["a.md", "b.md", "c.md"], {
      split: { left: "a.md", right: "b.md", active: "right", ratio: 0.4 },
    });
    expect(groups.map((group) => group.kind)).toEqual(["split", "single"]);
  });
});

describe("groupForTab", () => {
  const groups = [split("s", "b.pdf", "a.pdf"), single("a", "a.pdf")];
  it("stays on the active group when it already shows the file", () => {
    expect(groupForTab(groups, "s", "a.pdf")?.id).toBe("s");
  });
  it("otherwise prefers the file's own entry over a split", () => {
    expect(groupForTab(groups, null, "a.pdf")?.id).toBe("a");
    expect(groupForTab(groups, "a", "b.pdf")?.id).toBe("s");
  });
  it("returns nothing for a file no group shows", () => {
    expect(groupForTab(groups, "s", "c.md")).toBeUndefined();
  });
});
