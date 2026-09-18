import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, realpath, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app";

// These tests assert that a structural mutation makes the very next /api/tree
// read reflect the new filesystem, without waiting for the chokidar watcher to
// deliver an event. The server invalidates the WorkspaceFileIndex right after
// each tree-mutating endpoint (mutateTree), so snapshot() rescans on demand.

let root: string;
let app: ReturnType<typeof createApp>;
let headers: Record<string, string>;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "maek-tree-")));
  app = createApp({
    trash: async (p) => {
      await rm(p, { recursive: true, force: true });
    },
    open: async () => {},
    pick: async () => ({ status: "canceled" }),
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/workspaces/open",
    headers: { host: "127.0.0.1" },
    payload: { path: root },
  });
  headers = {
    host: "127.0.0.1",
    "x-workspace-id": response.json().wsId,
    "x-client-session-id": "tree-test",
  };
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

const request = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });

const treeIds = async (): Promise<string[]> =>
  (await request("GET", "/api/tree")).json().nodes.map((n: { id: string }) => n.id);

describe("tree index consistency after structural mutations", () => {
  it("reflects a newly created file immediately", async () => {
    expect(await treeIds()).not.toContain("Untitled.md");
    await request("POST", "/api/files", { dir: "", name: "Untitled.md", kind: "file" });
    expect(await treeIds()).toContain("Untitled.md");
  });

  it("reflects a newly created folder immediately", async () => {
    await request("POST", "/api/files", { dir: "", name: "Folder", kind: "dir" });
    expect(await treeIds()).toContain("Folder");
  });

  it("reflects a move/rename immediately", async () => {
    await request("POST", "/api/files", { dir: "", name: "Folder", kind: "dir" });
    await request("POST", "/api/files", { dir: "", name: "note.md", kind: "file" });
    await request("PATCH", "/api/files/path", {
      source: "note.md",
      dest: "Folder/note.md",
    });
    const ids = await treeIds();
    expect(ids).toContain("Folder/note.md");
    expect(ids).not.toContain("note.md");
  });

  it("reflects a copy immediately", async () => {
    await request("POST", "/api/files", { dir: "", name: "note.md", kind: "file" });
    await request("POST", "/api/files/copy", { dir: "", paths: ["note.md"] });
    expect(await treeIds()).toContain("note 2.md");
  });

  it("reflects an import immediately", async () => {
    await request("POST", "/api/files/import", {
      dir: "",
      files: [{ name: "dropped.md", data: Buffer.from("hi").toString("base64") }],
    });
    expect(await treeIds()).toContain("dropped.md");
  });

  it("reflects a trash (delete) immediately", async () => {
    await request("POST", "/api/files", { dir: "", name: "gone.md", kind: "file" });
    expect(await treeIds()).toContain("gone.md");
    await request("DELETE", "/api/files", { paths: ["gone.md"] });
    expect(await treeIds()).not.toContain("gone.md");
  });

  it("reflects a created database folder immediately", async () => {
    await request("POST", "/api/databases", {
      parent: "",
      name: "Board",
      viewType: "table",
    });
    expect(await treeIds()).toContain("Board");
  });

  it("reflects a database row (file) creation immediately", async () => {
    await request("POST", "/api/databases", {
      parent: "",
      name: "Board",
      viewType: "table",
    });
    await request("POST", "/api/databases/rows", {
      folderPath: "Board",
      values: { Name: "Task" },
    });
    const ids = await treeIds();
    // The new row is backed by a markdown file under the database folder.
    expect(ids.some((id) => id.startsWith("Board/") && id.endsWith(".md"))).toBe(
      true,
    );
  });

  it("reflects a database row rename (file rename) immediately", async () => {
    await request("POST", "/api/databases", {
      parent: "",
      name: "Board",
      viewType: "table",
    });
    // addRow returns the full rows array; take the first row's id.
    const rows = (
      await request("POST", "/api/databases/rows", { folderPath: "Board", values: {} })
    ).json();
    const rowId = rows[0].id;
    await request("PATCH", "/api/databases/row", {
      folderPath: "Board",
      rowId,
      name: "Renamed",
    });
    expect(await treeIds()).toContain("Board/Renamed.md");
  });

  it("reflects a folder converted into a database immediately (children stay listed)", async () => {
    await mkdir(path.join(root, "Notes"));
    await writeFile(path.join(root, "Notes/existing.md"), "Keep me");
    await request("POST", "/api/databases/convert", { folderPath: "Notes" });
    const ids = await treeIds();
    expect(ids).toContain("Notes");
    expect(ids).toContain("Notes/existing.md");
    // The folder is now a registered database.
    expect(
      (await request("GET", "/api/databases")).json().map((d: { folderPath: string }) => d.folderPath),
    ).toContain("Notes");
  });
});
