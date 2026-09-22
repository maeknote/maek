import { describe, expect, it } from "vitest";
import { parseFileName } from "../client/src/features/editor/utils/fileName";
import {
  getDisplayName,
  toFileName,
} from "../client/src/features/editor/utils/displayName";

describe("parseFileName", () => {
  it("splits a simple name and extension", () => {
    expect(parseFileName("note.md")).toEqual({ stem: "note", extension: ".md" });
  });
  it("uses the last dot for multi-part extensions", () => {
    expect(parseFileName("archive.tar.gz")).toEqual({
      stem: "archive.tar",
      extension: ".gz",
    });
  });
  it("treats a leading-dot dotfile as having no extension", () => {
    expect(parseFileName(".env")).toEqual({ stem: ".env", extension: "" });
  });
  it("treats an extensionless name as all stem", () => {
    expect(parseFileName("README")).toEqual({ stem: "README", extension: "" });
  });
  it("treats a trailing-dot name as having no extension", () => {
    expect(parseFileName("name.")).toEqual({ stem: "name.", extension: "" });
  });
  it("preserves original casing", () => {
    expect(parseFileName("Report.MD")).toEqual({
      stem: "Report",
      extension: ".MD",
    });
  });
});

describe("getDisplayName / toFileName round trip", () => {
  it("hides then restores the extension", () => {
    expect(getDisplayName("note.md")).toBe("note");
    expect(toFileName("renamed", "note.md")).toBe("renamed.md");
  });
  it("does not double-append an extension the user already typed", () => {
    expect(toFileName("renamed.md", "note.md")).toBe("renamed.md");
  });
  it("leaves extensionless names untouched", () => {
    expect(getDisplayName("README")).toBe("README");
    expect(toFileName("README2", "README")).toBe("README2");
  });
});
