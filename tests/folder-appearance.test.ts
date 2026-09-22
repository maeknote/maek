import { describe, expect, it } from "vitest";
import { remapFolderAppearancePaths } from "../server/metadata/folder-appearance";

const icon = (id: string) => ({ icon: id, iconColor: "accent" });

describe("remapFolderAppearancePaths", () => {
  it("remaps the moved folder key itself", () => {
    const result = remapFolderAppearancePaths(
      { Notes: icon("star") },
      "Notes",
      "Archive/Notes",
    );
    expect(result).toEqual({ "Archive/Notes": icon("star") });
  });

  it("remaps every configured descendant, preserving suffixes", () => {
    const result = remapFolderAppearancePaths(
      {
        Projects: icon("work"),
        "Projects/Alpha": icon("rocket"),
        "Projects/Alpha/Sub": icon("star"),
      },
      "Projects",
      "Team/Projects",
    );
    expect(result).toEqual({
      "Team/Projects": icon("work"),
      "Team/Projects/Alpha": icon("rocket"),
      "Team/Projects/Alpha/Sub": icon("star"),
    });
  });

  it("preserves entries that are not affected by the move", () => {
    const result = remapFolderAppearancePaths(
      { Notes: icon("star"), Other: icon("flag") },
      "Notes",
      "Archive/Notes",
    );
    expect(result).toEqual({
      Other: icon("flag"),
      "Archive/Notes": icon("star"),
    });
  });

  it("does not remap a sibling that merely shares a name prefix", () => {
    // "Notesy" starts with "Notes" but is not "Notes" nor "Notes/...".
    const result = remapFolderAppearancePaths(
      { Notes: icon("star"), Notesy: icon("flag") },
      "Notes",
      "Archive/Notes",
    );
    expect(result).toEqual({
      Notesy: icon("flag"),
      "Archive/Notes": icon("star"),
    });
  });

  it("lets the moved folder win when it collides with a stale destination entry", () => {
    const result = remapFolderAppearancePaths(
      {
        Notes: icon("star"),
        // Stale metadata already sitting at the destination path.
        "Archive/Notes": icon("archive"),
      },
      "Notes",
      "Archive/Notes",
    );
    expect(result).toEqual({ "Archive/Notes": icon("star") });
  });

  it("returns null when nothing matches (no rewrite)", () => {
    expect(
      remapFolderAppearancePaths({ Other: icon("flag") }, "Notes", "Archive/Notes"),
    ).toBeNull();
  });

  it("returns null for an empty map", () => {
    expect(remapFolderAppearancePaths({}, "Notes", "Archive/Notes")).toBeNull();
  });

  it("returns null when source equals dest", () => {
    expect(
      remapFolderAppearancePaths({ Notes: icon("star") }, "Notes", "Notes"),
    ).toBeNull();
  });
});
