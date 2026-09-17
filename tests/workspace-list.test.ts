import { describe, it, expect } from "vitest";
import {
  MAX_RECENT_WORKSPACES,
  removeWorkspaceFromList,
  addWorkspaceToList,
  type RecentWorkspace,
} from "../client/src/lib/workspaceList";

const ws = (path: string): RecentWorkspace => ({
  id: path,
  name: path.split("/").pop() ?? path,
  path,
});

describe("recent workspace list: removal is non-destructive", () => {
  it("removes only the matching entry and keeps the rest in order", () => {
    const list = [ws("/a"), ws("/b"), ws("/c")];
    const result = removeWorkspaceFromList(list, "/b");
    expect(result.map((w) => w.path)).toEqual(["/a", "/c"]);
  });

  it("does not mutate the original array (no destructive side effects)", () => {
    const list = [ws("/a"), ws("/b")];
    const snapshot = list.map((w) => w.path);
    removeWorkspaceFromList(list, "/a");
    expect(list.map((w) => w.path)).toEqual(snapshot);
  });

  it("is a no-op when the path is not present", () => {
    const list = [ws("/a"), ws("/b")];
    expect(removeWorkspaceFromList(list, "/missing").map((w) => w.path)).toEqual(
      ["/a", "/b"],
    );
  });

  it("returns an empty list when the only entry is removed", () => {
    expect(removeWorkspaceFromList([ws("/only")], "/only")).toEqual([]);
  });
});

describe("recent workspace list: add / dedupe / cap", () => {
  it("moves an existing path to the front without duplicating", () => {
    const list = [ws("/a"), ws("/b"), ws("/c")];
    const result = addWorkspaceToList(list, ws("/c"));
    expect(result.map((w) => w.path)).toEqual(["/c", "/a", "/b"]);
  });

  it("caps the list at the maximum recent-workspaces policy", () => {
    const list = Array.from({ length: MAX_RECENT_WORKSPACES }, (_, i) =>
      ws(`/w${i}`),
    );
    const result = addWorkspaceToList(list, ws("/new"));
    expect(result).toHaveLength(MAX_RECENT_WORKSPACES);
    expect(result[0]?.path).toBe("/new");
  });
});
