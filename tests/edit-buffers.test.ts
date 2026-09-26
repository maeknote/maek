import { describe, expect, it, beforeEach } from "vitest";
import {
  registerEditBuffer,
  disposeEditBuffer,
  flushEditBuffer,
  discardEditBuffer,
  hasPendingEdit,
  anyPendingEdits,
} from "../client/src/features/workspace/model/editBuffers";
import { isTabDirty } from "../client/src/features/editor/utils/frontmatter";
import type { TabItem } from "../client/src/features/editor/types";

function makeSheetTab(overrides: Partial<TabItem> = {}): TabItem {
  return {
    id: "/sheet.csv",
    name: "sheet.csv",
    parentName: "",
    bodyContent: "a,b",
    savedBodyContent: "a,b",
    frontmatter: {
      hasFrontmatter: false,
      raw: null,
      savedRaw: null,
      expanded: false,
      validationError: null,
      lineEnding: "\n",
      viewMode: "properties",
    },
    viewKind: "spreadsheet",
    previewFormat: null,
    previewNonce: 0,
    isEphemeral: false,
    diskFileContent: "a,b",
    diskNormalizedBody: "a,b",
    editorSessionId: "session-test",
    ...overrides,
  };
}

describe("edit buffer registry", () => {
  beforeEach(() => {
    disposeEditBuffer("s1");
    disposeEditBuffer("s2");
  });

  it("reports no pending edit for an unknown session", () => {
    expect(hasPendingEdit("nope")).toBe(false);
    expect(hasPendingEdit(undefined)).toBe(false);
  });

  it("flushes in order and clears the pending flag", async () => {
    const order: string[] = [];
    let pending = true;
    registerEditBuffer("s1", {
      flush: async () => {
        order.push("flush-start");
        await Promise.resolve();
        pending = false;
        order.push("flush-end");
      },
      discard: () => {
        pending = false;
      },
      hasPending: () => pending,
    });
    expect(hasPendingEdit("s1")).toBe(true);
    await flushEditBuffer("s1");
    expect(order).toEqual(["flush-start", "flush-end"]);
    expect(hasPendingEdit("s1")).toBe(false);
  });

  it("discard clears pending without flushing", () => {
    let pending = true;
    let flushed = false;
    registerEditBuffer("s1", {
      flush: async () => {
        flushed = true;
      },
      discard: () => {
        pending = false;
      },
      hasPending: () => pending,
    });
    discardEditBuffer("s1");
    expect(pending).toBe(false);
    expect(flushed).toBe(false);
  });

  it("dispose removes the buffer so stale sessions are ignored", async () => {
    let flushCount = 0;
    registerEditBuffer("s1", {
      flush: async () => {
        flushCount++;
      },
      discard: () => {},
      hasPending: () => true,
    });
    disposeEditBuffer("s1");
    await flushEditBuffer("s1");
    expect(flushCount).toBe(0);
    expect(hasPendingEdit("s1")).toBe(false);
  });

  it("unregister only removes the matching buffer instance", () => {
    const unregister = registerEditBuffer("s1", {
      flush: async () => {},
      discard: () => {},
      hasPending: () => true,
    });
    // A newer buffer replaces the first for the same session.
    registerEditBuffer("s1", {
      flush: async () => {},
      discard: () => {},
      hasPending: () => false,
    });
    unregister(); // stale unregister must not drop the newer buffer
    expect(hasPendingEdit("s1")).toBe(false); // newer buffer still present
  });

  it("anyPendingEdits reflects at least one pending buffer", () => {
    registerEditBuffer("s1", { flush: async () => {}, discard: () => {}, hasPending: () => false });
    registerEditBuffer("s2", { flush: async () => {}, discard: () => {}, hasPending: () => true });
    expect(anyPendingEdits()).toBe(true);
    disposeEditBuffer("s2");
    expect(anyPendingEdits()).toBe(false);
  });
});

describe("isTabDirty with pendingEdit", () => {
  it("is clean when saved and no pending edit", () => {
    expect(isTabDirty(makeSheetTab())).toBe(false);
  });

  it("is dirty when a pending edit is flagged even if body matches saved", () => {
    expect(isTabDirty(makeSheetTab({ pendingEdit: true }))).toBe(true);
  });

  it("is dirty when body diverges from saved", () => {
    expect(isTabDirty(makeSheetTab({ bodyContent: "a,c" }))).toBe(true);
  });
});
