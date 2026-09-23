import { describe, it, expect } from "vitest";
import { isHiddenTreePath } from "../client/src/features/explorer/utils/hiddenPath";

describe("isHiddenTreePath", () => {
  it("treats dot-prefixed top-level entries as hidden", () => {
    expect(isHiddenTreePath(".gitignore")).toBe(true);
    expect(isHiddenTreePath(".codex")).toBe(true);
    expect(isHiddenTreePath(".claude")).toBe(true);
  });

  it("treats any dot-prefixed segment along the path as hidden", () => {
    expect(isHiddenTreePath(".codex/config.md")).toBe(true);
    expect(isHiddenTreePath("notes/.private/todo.md")).toBe(true);
  });

  it("keeps ordinary files and folders visible", () => {
    expect(isHiddenTreePath("note.md")).toBe(false);
    expect(isHiddenTreePath("My folder/Nested note.md")).toBe(false);
    expect(isHiddenTreePath("v1.2/report.md")).toBe(false);
  });
});
