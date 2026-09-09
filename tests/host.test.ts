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
    payload: { path: root },
  });
  headers = {
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
  it("persists and restores workspace metadata and handles corrupt session JSON", async () => {
    const session = {
      tabs: ["a.md"],
      activeTabId: "a.md",
      scrollPositions: { "a.md": 123 },
      expanded: ["folder"],
      theme: "dark",
      sidebarWidth: 280,
    };
    expect(
      (await request("PUT", "/api/workspace/tabs", session)).statusCode,
    ).toBe(200);
    expect((await request("GET", "/api/workspace/tabs")).json()).toEqual(
      session,
    );
    expect(
      JSON.parse(
        await readFile(
          path.join(root, ".maek/sessions/web/host-test/tabs.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      version: 4,
      tabs: [{ id: path.join(root, "a.md") }],
      theme: "dark",
    });
    await writeFile(
      path.join(root, ".maek/sessions/web/host-test/tabs.json"),
      "{",
    );
    expect((await request("GET", "/api/workspace/tabs")).json().tabs).toEqual(
      [],
    );
  });
  it("isolates web window sessions and never overwrites desktop tabs", async () => {
    const desktopTabs = { version: 4, tabs: [], marker: "desktop" };
    await writeFile(
      path.join(root, ".maek/tabs.json"),
      JSON.stringify(desktopTabs),
    );
    const session = {
      tabs: ["a.md"],
      activeTabId: "a.md",
      scrollPositions: {},
      expanded: [],
      theme: "light",
      sidebarWidth: 260,
    };
    for (const id of ["window-a", "window-b"]) {
      const response = await app.inject({
        method: "PUT",
        url: "/api/workspace/tabs",
        headers: {
          ...headers,
          "x-client-session-id": id,
        },
        payload: { ...session, activeTabId: id === "window-a" ? "a.md" : null },
      });
      expect(response.statusCode).toBe(200);
    }
    expect(
      JSON.parse(await readFile(path.join(root, ".maek/tabs.json"), "utf8")),
    ).toEqual(desktopTabs);
    expect(
      await stat(path.join(root, ".maek/sessions/web/window-a/tabs.json")),
    ).toBeTruthy();
    expect(
      await stat(path.join(root, ".maek/sessions/web/window-b/tabs.json")),
    ).toBeTruthy();
  });
  it("classifies previews and never serves HTML or executable content", async () => {
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
    const ws = headers["x-workspace-id"];
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
          headers: { host: "attacker.example", ...headers },
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
  it("has no legacy library, notes or database routes", async () => {
    for (const url of ["/api/library", "/api/notes", "/api/databases"])
      expect((await request("GET", url)).statusCode).toBe(404);
  });
});
