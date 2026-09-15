import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  stat,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server/app";
let root: string;
let trashed: string[];
let opened: string[];
let app: ReturnType<typeof createApp>;
let headers: Record<string, string>;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "maek-host-")));
  trashed = [];
  opened = [];
  app = createApp({
    trash: async (p) => {
      trashed.push(p);
    },
    open: async (p) => {
      opened.push(p);
    },
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
    "x-client-session-id": "host-test",
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
describe("real workspace host", () => {
  it("opens arbitrary nested files without creating a note catalog", async () => {
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "한국어.md"), "# 기존 노트");
    await writeFile(path.join(root, "plain.txt"), "Hello");
    await mkdir(path.join(root, "node_modules"));
    await writeFile(path.join(root, "node_modules", "ignored.md"), "ignore");
    const tree = (await request("GET", "/api/tree")).json();
    expect(tree.nodes.map((n: { id: string }) => n.id)).toEqual([
      "nested",
      "plain.txt",
      "nested/한국어.md",
    ]);
    expect(await readdir(root)).toEqual(
      expect.arrayContaining([".maek", "nested", "plain.txt"]),
    );
    for (const name of ["notes", "history", "databases.json"])
      expect(await stat(path.join(root, name)).catch(() => null)).toBeNull();
    expect(
      (
        await request("GET", "/api/files/content?path=nested%2F한국어.md")
      ).json(),
    ).toMatchObject({ kind: "editor", content: "# 기존 노트" });
  });
  it("shares folder icons with the desktop app through folder-appearance.json", async () => {
    await mkdir(path.join(root, ".maek"), { recursive: true });
    const desktopAppearances = {
      version: 1,
      folders: {
        Folder: { icon: "rocket", iconColor: "blue" },
        "Folder/Nested": { icon: "book", iconColor: "accent" },
      },
    };
    await writeFile(
      path.join(root, ".maek/folder-appearance.json"),
      JSON.stringify(desktopAppearances),
    );

    expect(
      (await request("GET", "/api/workspace/folder-appearance")).json(),
    ).toEqual(desktopAppearances);

    const updatedAppearances = {
      version: 1,
      folders: { Folder: { icon: "star", iconColor: "green" } },
    };
    expect(
      (
        await request(
          "PUT",
          "/api/workspace/folder-appearance",
          updatedAppearances,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      JSON.parse(
        await readFile(
          path.join(root, ".maek/folder-appearance.json"),
          "utf8",
        ),
      ),
    ).toEqual(updatedAppearances);
    expect(
      await stat(path.join(root, ".maek/folderAppearance.json")).catch(
        () => null,
      ),
    ).toBeNull();
  });
  it("saves actual paths atomically and rejects stale or concurrent baselines", async () => {
    await writeFile(
      path.join(root, "note.md"),
      "---\nunknown: keep\n---\n\nOriginal",
    );
    const before = (
      await request("GET", "/api/files/content?path=note.md")
    ).json();
    const body = {
      path: "note.md",
      content: "---\nunknown: keep\n---\n\nEdited",
      baseHash: before.hash,
      baseMtimeMs: before.mtimeMs,
    };
    const responses = await Promise.all([
      request("PUT", "/api/files/content", body),
      request("PUT", "/api/files/content", {
        ...body,
        content: "Stale overwrite",
      }),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(
      body.content,
    );
    expect((await readdir(root)).some((n) => n.endsWith(".tmp"))).toBe(false);
  });
  it("creates, reads and saves CSV files through the editable sheet path", async () => {
    const created = await request("POST", "/api/files", {
      dir: "",
      name: "Data.csv",
      kind: "file",
    });
    expect(created.statusCode).toBe(200);
    const before = (await request("GET", "/api/files/content?path=Data.csv")).json();
    expect(before).toMatchObject({ kind: "sheet", content: "" });
    const saved = await request("PUT", "/api/files/content", {
      path: "Data.csv",
      content: "name,value\nalpha,1",
      baseHash: before.hash,
      baseMtimeMs: before.mtimeMs,
    });
    expect(saved.statusCode).toBe(200);
    expect(await readFile(path.join(root, "Data.csv"), "utf8")).toBe("name,value\nalpha,1");
  });
  it("preserves an UTF-8 BOM when reading CSV", async () => {
    await writeFile(path.join(root, "bom.csv"), Buffer.from("\uFEFFa,b\r\n1,2", "utf8"));
    const file = (await request("GET", "/api/files/content?path=bom.csv")).json();
    expect(file.kind).toBe("sheet");
    expect(file.content.startsWith("\uFEFF")).toBe(true);
  });
  it("rejects CSV writes that exceed the sheet shape limits", async () => {
    await writeFile(path.join(root, "wide.csv"), "a");
    const before = (await request("GET", "/api/files/content?path=wide.csv")).json();
    const response = await request("PUT", "/api/files/content", {
      path: "wide.csv",
      content: Array.from({ length: 201 }, (_, index) => `c${index}`).join(","),
      baseHash: before.hash,
      baseMtimeMs: before.mtimeMs,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/200 columns/);
  });
  it("rejects external modifications and missing files without resurrecting them", async () => {
    await writeFile(path.join(root, "note.md"), "Original");
    const base = (
      await request("GET", "/api/files/content?path=note.md")
    ).json();
    await writeFile(path.join(root, "note.md"), "External");
    const body = {
      path: "note.md",
      content: "Mine",
      baseHash: base.hash,
      baseMtimeMs: base.mtimeMs,
    };
    expect((await request("PUT", "/api/files/content", body)).statusCode).toBe(
      409,
    );
    await rm(path.join(root, "note.md"));
    expect((await request("PUT", "/api/files/content", body)).statusCode).toBe(
      409,
    );
    expect(await stat(path.join(root, "note.md")).catch(() => null)).toBeNull();
  });
  it("creates, renames, copies and resolves duplicate names", async () => {
    const create = () =>
      request("POST", "/api/files", {
        dir: "",
        name: "Untitled.md",
        kind: "file",
      });
    expect((await create()).json().id).toBe("Untitled.md");
    expect((await create()).json().id).toBe("Untitled 2.md");
    expect(
      (
        await request("POST", "/api/files", {
          dir: "",
          name: "Folder",
          kind: "dir",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request("PATCH", "/api/files/path", {
          source: "Untitled.md",
          dest: "Folder/Renamed.md",
        })
      ).statusCode,
    ).toBe(200);
    const copied = (
      await request("POST", "/api/files/copy", {
        dir: "Folder",
        paths: ["Folder/Renamed.md"],
      })
    ).json();
    expect(copied[0].id).toBe("Folder/Renamed 2.md");
    expect(
      (
        await request("PATCH", "/api/files/path", {
          source: "Folder",
          dest: "Folder/inside",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await request("PATCH", "/api/files/path", {
          source: "Folder/Renamed.md",
          dest: "Folder/Renamed 2.md",
        })
      ).statusCode,
    ).toBe(409);
  });
  it("imports bytes without overwriting and stores images only under .maek", async () => {
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request("POST", "/api/files/import", {
            dir: "",
            files: [
              {
                name: "drop.md",
                data: Buffer.from("Dropped").toString("base64"),
              },
            ],
          })
        ).statusCode,
      ).toBe(200);
    expect(await readFile(path.join(root, "drop 2.md"), "utf8")).toBe(
      "Dropped",
    );
    const image = (
      await request("POST", "/api/files/image", {
        name: "image.png",
        data: "iVBORw0KGgo=",
      })
    ).json();
    expect(image.path).toBe(".maek/assets/image.png");
    expect(
      (await request("GET", "/api/tree"))
        .json()
        .nodes.some((n: { id: string }) => n.id.startsWith(".maek")),
    ).toBe(false);
  });
  it("stores the open-tab list in the root document and UI state per browser", async () => {
    const rootTabs = { tabs: ["a.md"], activeTabId: "a.md" };
    expect(
      (await request("PUT", "/api/workspace/tabs", rootTabs)).statusCode,
    ).toBe(200);
    const ui = {
      activeTabId: "a.md",
      scrollPositions: { "a.md": 123 },
      expanded: ["folder"],
      theme: "dark",
      sidebarWidth: 280,
    };
    expect(
      (await request("PUT", "/api/workspace/ui-state", ui)).statusCode,
    ).toBe(200);
    expect((await request("GET", "/api/workspace/tabs")).json()).toEqual(
      rootTabs,
    );
    expect((await request("GET", "/api/workspace/ui-state")).json()).toEqual(
      ui,
    );
    // The open-tab list lives in the workspace-root document, in the original
    // app's version-4 format with absolute paths.
    expect(
      JSON.parse(await readFile(path.join(root, ".maek/tabs.json"), "utf8")),
    ).toMatchObject({
      version: 4,
      tabs: [{ id: path.join(root, "a.md"), viewKind: "editor" }],
      activeTabId: path.join(root, "a.md"),
    });
    // UI state stays in the per-browser session file, never the root document.
    expect(
      JSON.parse(
        await readFile(
          path.join(root, ".maek/sessions/web/host-test/ui.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ theme: "dark", sidebarWidth: 280 });
    // A corrupt root document degrades to an empty tab list.
    await writeFile(path.join(root, ".maek/tabs.json"), "{");
    expect((await request("GET", "/api/workspace/tabs")).json().tabs).toEqual(
      [],
    );
  });
  it("reads only web-supported tabs from a version-4 root document as relative paths", async () => {
    await writeFile(
      path.join(root, ".maek/tabs.json"),
      JSON.stringify({
        version: 4,
        tabs: [
          { id: path.join(root, "note.md"), viewKind: "editor" },
          { id: path.join(root, "sheet"), viewKind: "database" },
          { id: path.join(root, "team meeting"), viewKind: "meeting" },
          { id: "/outside/other.md", viewKind: "editor" },
          { id: path.join(root, "preview.pdf"), viewKind: "preview" },
        ],
        activeTabId: path.join(root, "note.md"),
      }),
    );
    expect((await request("GET", "/api/workspace/tabs")).json()).toEqual({
      tabs: ["note.md", "preview.pdf"],
      activeTabId: "note.md",
    });
  });
  it("preserves desktop-only tabs, unknown fields, groups and splits when the web reorders", async () => {
    const original = {
      version: 4,
      tabs: [
        { id: path.join(root, "sheet"), viewKind: "database", extra: "keep" },
        { id: path.join(root, "a.md"), viewKind: "editor" },
        { id: path.join(root, "b.md"), viewKind: "editor" },
      ],
      activeTabId: path.join(root, "a.md"),
      tabGroups: [{ id: "g1", tabIds: ["x"] }],
      editorSplit: { layout: "columns-2" },
      windowBounds: { width: 1200 },
    };
    await writeFile(
      path.join(root, ".maek/tabs.json"),
      JSON.stringify(original),
    );
    // Web reorders its two file tabs and drops none.
    expect(
      (
        await request("PUT", "/api/workspace/tabs", {
          tabs: ["b.md", "a.md"],
          activeTabId: "b.md",
        })
      ).statusCode,
    ).toBe(200);
    const stored = JSON.parse(
      await readFile(path.join(root, ".maek/tabs.json"), "utf8"),
    );
    // Desktop-only entry, its unknown field, groups and split survive.
    expect(stored.tabGroups).toEqual(original.tabGroups);
    expect(stored.editorSplit).toEqual(original.editorSplit);
    expect(stored.windowBounds).toEqual(original.windowBounds);
    expect(stored.tabs).toEqual([
      { id: path.join(root, "sheet"), viewKind: "database", extra: "keep" },
      expect.objectContaining({ id: path.join(root, "b.md") }),
      expect.objectContaining({ id: path.join(root, "a.md") }),
    ]);
    // The desktop-only tab stays hidden from the web view, in the new order.
    expect((await request("GET", "/api/workspace/tabs")).json()).toEqual({
      tabs: ["b.md", "a.md"],
      activeTabId: "b.md",
    });
  });
  it("seeds the shared root document from a browser's legacy session tabs", async () => {
    // Legacy per-browser session file (old Session shape) is migration input.
    await mkdir(path.join(root, ".maek/sessions/web/host-test"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".maek/sessions/web/host-test/tabs.json"),
      JSON.stringify({
        version: 4,
        tabs: [{ id: path.join(root, "legacy.md"), viewKind: "editor" }],
        activeTabId: path.join(root, "legacy.md"),
        theme: "dark",
      }),
    );
    expect((await request("GET", "/api/workspace/tabs")).json()).toEqual({
      tabs: ["legacy.md"],
      activeTabId: "legacy.md",
    });
    // UI state migrates theme from the same legacy file.
    expect(
      (await request("GET", "/api/workspace/ui-state")).json().theme,
    ).toBe("dark");
  });
  it("shares the root tab list across browsers but isolates UI state", async () => {
    const inject = (
      id: string,
      method: "GET" | "PUT",
      url: string,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method,
        url,
        headers: { ...headers, "x-client-session-id": id },
        ...(payload === undefined ? {} : { payload }),
      });
    await inject("window-a", "PUT", "/api/workspace/tabs", {
      tabs: ["a.md"],
      activeTabId: "a.md",
    });
    await inject("window-a", "PUT", "/api/workspace/ui-state", {
      activeTabId: "a.md",
      scrollPositions: {},
      expanded: [],
      theme: "dark",
      sidebarWidth: 300,
    });
    await inject("window-b", "PUT", "/api/workspace/ui-state", {
      activeTabId: null,
      scrollPositions: {},
      expanded: [],
      theme: "light",
      sidebarWidth: 200,
    });
    // Both browsers read the same shared tab list from the root document.
    expect((await inject("window-a", "GET", "/api/workspace/tabs")).json().tabs).toEqual(["a.md"]);
    expect((await inject("window-b", "GET", "/api/workspace/tabs")).json().tabs).toEqual(["a.md"]);
    // UI state is isolated per browser.
    expect((await inject("window-a", "GET", "/api/workspace/ui-state")).json().theme).toBe("dark");
    expect((await inject("window-b", "GET", "/api/workspace/ui-state")).json().theme).toBe("light");
    expect(
      await stat(path.join(root, ".maek/sessions/web/window-a/ui.json")),
    ).toBeTruthy();
    expect(
      await stat(path.join(root, ".maek/sessions/web/window-b/ui.json")),
    ).toBeTruthy();
  });
  it("classifies previews and serves artifact files through the isolated route", async () => {
    for (const [file, content] of [
      ["a.html", "<script>bad()</script>"],
      ["a.json", "{}"],
      ["a.pdf", "%PDF-1.4"],
      ["a.db", "\0binary"],
      ["a.svg", "<svg></svg>"],
    ])
      await writeFile(path.join(root, file!), content!);
    expect(
      (await request("GET", "/api/files/content?path=a.html")).json().kind,
    ).toBe("html");
    expect(
      (await request("GET", "/api/files/content?path=a.html")).json().content,
    ).toBe("<script>bad()</script>");
    expect(
      (await request("GET", "/api/files/content?path=a.db")).json().kind,
    ).toBe("unsupported");
    expect(
      (await request("GET", "/api/files/content?path=a.json")).json().kind,
    ).toBe("text");
    expect(
      (
        await request("PUT", "/api/files/content", {
          path: "a.json",
          content: "changed",
          baseHash: "x",
          baseMtimeMs: 0,
        })
      ).statusCode,
    ).toBe(400);
    const ws = headers["x-workspace-id"]!;
    expect(
      (await request("GET", `/api/files/raw?workspace=${ws}&path=a.html`))
        .statusCode,
    ).toBe(400);
    const svg = await request(
      "GET",
      `/api/files/raw?workspace=${ws}&path=a.svg`,
    );
    expect(svg.headers["content-security-policy"]).toContain("sandbox");
    expect(svg.headers["x-content-type-options"]).toBe("nosniff");

    await mkdir(path.join(root, "artifact"));
    await writeFile(
      path.join(root, "artifact", "index.html"),
      '<link rel="stylesheet" href="app.css"><script src="app.js"></script>',
    );
    await writeFile(path.join(root, "artifact", "app.css"), "body { color: red }");
    await writeFile(path.join(root, "artifact", "app.js"), "window.ready = true");
    const artifactBase = `/_artifacts/${encodeURIComponent(ws)}/artifact`;
    const artifact = await request("GET", `${artifactBase}/index.html`);
    expect(artifact.statusCode).toBe(200);
    expect(artifact.headers["content-type"]).toContain("text/html");
    expect(artifact.headers["content-security-policy"]).toContain(
      "allow-scripts",
    );
    expect((await request("GET", `${artifactBase}/app.css`)).headers["content-type"])
      .toContain("text/css");
    expect((await request("GET", `${artifactBase}/app.js`)).body).toContain(
      "window.ready",
    );
    expect((await request("GET", `${artifactBase}/missing.json`)).statusCode).toBe(
      404,
    );
    expect(
      (await request("GET", `/_artifacts/${encodeURIComponent(ws)}/.maek/config.json`))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workspaces/open",
          headers: { host: "localhost" },
          payload: { path: root },
        })
      ).statusCode,
    ).toBe(403);

    // Test /api/run
    const runRes = await request("POST", "/api/run", {
      cmd: process.execPath,
      args: ["-e", "console.log('runner works')"],
    });
    expect(runRes.statusCode).toBe(200);
    expect(runRes.json().stdout.trim()).toBe("runner works");
    expect(runRes.json().exitCode).toBe(0);
  });
  it("blocks traversal, symlinks, foreign origins and managed metadata mutations", async () => {
    await symlink(tmpdir(), path.join(root, "escape"));
    await symlink(tmpdir(), path.join(root, ".maek", "escape"));
    expect((await request("GET", "/api/tree")).json().nodes).toEqual([]);
    expect(
      (await request("GET", "/api/files/content?path=../outside.md"))
        .statusCode,
    ).toBe(400);
    expect(
      (await request("GET", "/api/files/content?path=escape/note.md"))
        .statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await request("DELETE", "/api/files", { paths: [".maek"] })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/workspaces/pick",
          headers: { origin: "https://example.com" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/tree",
          headers: { ...headers, host: "attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("passes exact resolved paths to OS adapters and accepts empty picker requests", async () => {
    await writeFile(path.join(root, "a.md"), "a");
    expect((await request("POST", "/api/workspaces/pick")).json()).toEqual({
      status: "canceled",
    });
    await request("POST", "/api/files/open-external", { path: "a.md" });
    await request("DELETE", "/api/files", { paths: ["a.md"] });
    expect(opened).toEqual([path.join(root, "a.md")]);
    expect(trashed).toEqual([path.join(root, "a.md")]);
  });
  it("has no legacy library or notes routes", async () => {
    for (const url of ["/api/library", "/api/notes"])
      expect((await request("GET", url)).statusCode).toBe(404);
  });

  it("lists database manifests", async () => {
    const response = await request("GET", "/api/databases");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("creates and edits an app-compatible database without changing the note body", async () => {
    const created = await request("POST", "/api/databases", {
      parent: "",
      name: "Project Board",
      viewType: "kanban",
    });
    expect(created.statusCode).toBe(200);
    const meta = created.json();
    expect(meta.folderPath).toBe("Project Board");
    expect(meta.views[0].type).toBe("kanban");
    expect(meta.schema.map((column: { name: string }) => column.name)).toContain("Status");
    expect(JSON.parse(await readFile(path.join(root, "Project Board/.maek-database.json"), "utf8"))).toMatchObject({ version: 1, type: "database", id: meta.id });

    await writeFile(path.join(root, "Project Board/task.md"), "---\ntitle: Task # keep\nStatus: To Do\n---\n\n# Body\n");
    const rows = (await request("GET", "/api/databases/rows?folderPath=Project%20Board")).json();
    expect(rows).toHaveLength(1);
    expect((await request("PATCH", "/api/databases/cell", {
      folderPath: "Project Board",
      rowId: rows[0].id,
      key: "Status",
      value: "Done",
    })).statusCode).toBe(200);
    const content = await readFile(path.join(root, "Project Board/task.md"), "utf8");
    expect(content).toContain("title: Task # keep");
    expect(content).toContain("Status: Done");
    expect(content).toContain("# Body");

    const manifestPath = path.join(root, "Project Board/.maek-database.json");
    const beforeInvalidUpdate = await readFile(manifestPath, "utf8");
    expect((await request("PUT", "/api/databases/manifest", {
      folderPath: "Project Board",
      manifest: { ...meta, activeViewId: "missing-view" },
    })).statusCode).toBe(400);
    expect(await readFile(manifestPath, "utf8")).toBe(beforeInvalidUpdate);
  });
});
