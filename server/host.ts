import {
  dashboard,
  saveConfig,
  resetWorkspaceState,
  readRecents,
  recentList,
  mutateRecents,
} from "./metadata/settings";
import Fastify from "fastify";
import { z } from "zod";
import path from "node:path";
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  stat,
  lstat,
  rename,
  copyFile,
} from "node:fs/promises";
import { createReadStream, constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  registerWorkspace,
  getWorkspace,
  toRef,
  type Workspace,
} from "./workspaces";
import { resolveInWorkspace } from "./fs/guard";
import { pickDirectory } from "./fs/pickDirectory";
import { readFile as readContent } from "./fs/readFile";
import { writeFile as saveContent } from "./fs/writeFile";
import { CSV_EDIT_LIMITS, validateCsvForEditing } from "./fs/validateCsv";
import { RpcHttpError, badRequest, fsError, conflict } from "./errors";
import { RelPath, WriteFileRequest } from "../shared/contract";
import type {
  FileNode,
  FileContent,
  WorkspaceEvent,
} from "../shared/workspace";
import { WorkspaceRuntimeManager } from "./workspace/runtime-manager";
import { WorkspaceMetadataRepository } from "./metadata/repository";
import {
  isIgnored,
  nodeFor,
  workspaceTarget as target,
} from "./workspace/filesystem";
import {
  artifactMime,
  kindFor,
  previewMime as mime,
} from "./workspace/file-kind";
import {
  readRootTabs,
  mergeRootTabs,
  type RootTabsDocument,
} from "./workspace/root-tabs";
import {
  addRow as addDatabaseRow,
  createDatabase,
  listDatabases,
  reorderRows as reorderDatabaseRows,
  renameRow as renameDatabaseRow,
  rows as databaseRows,
  updateCell as updateDatabaseCell,
  updateManifest,
  databaseCommand,
  convertFolder,
  databaseFolderMoved,
} from "./database";
import type {
  DatabaseManifest,
  DatabaseMeta,
  DatabaseViewType,
} from "../shared/database";

const run = promisify(execFile);
const filePath = RelPath.refine(
  (p) => !p.split("/").includes(".."),
  "Parent traversal is forbidden",
);
const userPath = filePath.refine(
  (p) => !!p && !p.split("/").includes(".maek"),
  "Managed workspace path",
);
const nameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (n) => n !== "." && n !== ".." && !/[\\/\0]/.test(n) && n !== ".maek",
    "Invalid name",
  );
async function unique(ws: Workspace, dir: string, name: string) {
  for (let n = 1; n < 10000; n++) {
    const ext = path.extname(name);
    const stem = name.slice(0, name.length - ext.length);
    const p = path.posix.join(dir, n === 1 ? name : `${stem} ${n}${ext}`);
    if (!(await lstat(await target(ws, p)).catch(() => null))) return p;
  }
  throw badRequest("Too many name conflicts");
}
async function copyTree(ws: Workspace, source: string, dest: string) {
  const src = await target(ws, source);
  const s = await lstat(src);
  const to = await target(ws, dest);
  if (s.isDirectory()) {
    await mkdir(to);
    for (const e of await readdir(src)) {
      if (e === ".maek") continue;
      await copyTree(ws, path.posix.join(source, e), path.posix.join(dest, e));
    }
  } else if (s.isFile()) await copyFile(src, to, constants.COPYFILE_EXCL);
  else throw badRequest("Only regular files and folders can be copied");
}

export interface HostOptions {
  pick?: typeof pickDirectory;
  trash?: (p: string) => Promise<void>;
  open?: (p: string) => Promise<void>;
}
export function createHost(options: HostOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 48 * 1024 * 1024 });
  const streams = new Set<() => Promise<void>>();
  const runtimes = new WorkspaceRuntimeManager(isIgnored);
  const metadata = new WorkspaceMetadataRepository();
  const locks = new Map<string, Promise<unknown>>();
  async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(key, next);
    try {
      return await next;
    } finally {
      if (locks.get(key) === next) locks.delete(key);
    }
  }
  app.addHook("preClose", async () => {
    await Promise.all([...streams].map((close) => close()));
    await runtimes.close();
  });
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host ?? "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
      return reply.code(403).send({ message: "Use the local address" });
    if (/^localhost(?::\d+)?$/.test(host) && req.url.startsWith("/api/"))
      return reply
        .code(403)
        .send({ message: "Artifact previews cannot access application APIs" });
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return reply
        .code(403)
        .send({ message: "Cross-origin requests are not allowed" });
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof RpcHttpError)
      return reply
        .code(err.status)
        .send({ error: err.code, message: err.message, reason: err.reason });
    if (err instanceof z.ZodError)
      return reply.code(400).send({
        error: "bad_request",
        message: err.issues.map((i) => i.message).join("; "),
      });
    const e = err as Error & { statusCode?: number; code?: string };
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({ message: e.message });
    const mapped = fsError(err, "File operation");
    return reply
      .code(mapped.status)
      .send({ error: mapped.code, message: mapped.message });
  });
  const wsFor = (req: { headers: Record<string, unknown> }) =>
    getWorkspace(z.string().parse(req.headers["x-workspace-id"]));
  const sessionFor = (req: { headers: Record<string, unknown> }) =>
    z
      .string()
      .regex(/^[a-zA-Z0-9-]{1,80}$/)
      .catch("default")
      .parse(req.headers["x-client-session-id"]);
  app.post("/api/workspaces/open", async (req) => {
    const { path: p } = z.object({ path: z.string().min(1) }).parse(req.body);
    const ws = await registerWorkspace(p);
    await metadata.path(ws, "config.json");
    return toRef(ws);
  });
  app.post("/api/workspaces/pick", async () => {
    const result = await (options.pick ?? pickDirectory)();
    if (result.status === "ok")
      await metadata.path(getWorkspace(result.workspace.wsId), "config.json");
    return result;
  });
  app.get("/api/tree", async (req) =>
    runtimes.get(wsFor(req)).files.snapshot(),
  );
  app.post("/api/databases/convert", async (req) => {
    const ws = wsFor(req),
      data = z.object({ folderPath: userPath }).parse(req.body);
    return serial(ws.root, () => convertFolder(ws, data.folderPath));
  });
  app.post("/api/databases/command", async (req) => {
    const ws = wsFor(req);
    return serial(ws.root, () => databaseCommand(ws, req.body));
  });
  app.get("/api/workspace/dashboard", async (req) =>
    serial(wsFor(req).root, () => dashboard(wsFor(req))),
  );
  app.patch("/api/workspace/config", async (req) => {
    const ws = wsFor(req),
      data = z
        .object({ description: z.string(), rawConfig: z.string().nullable() })
        .parse(req.body);
    return serial(ws.root, () =>
      saveConfig(ws, data.description, data.rawConfig),
    );
  });
  app.post("/api/workspace/reset", async (req) => {
    const ws = wsFor(req),
      data = z
        .object({ action: z.enum(["tabs", "appearance"]) })
        .parse(req.body);
    return serial(ws.root, () => resetWorkspaceState(ws, data.action));
  });
  app.post("/api/workspace/recent-files", async (req) => {
    const ws = wsFor(req),
      data = z
        .object({
          action: z.enum(["open", "remove", "clear"]),
          path: filePath.optional(),
        })
        .parse(req.body);
    if (data.path !== undefined) await target(ws, data.path);
    return serial(ws.root, () => mutateRecents(ws, data.action, data.path));
  });
  app.get("/api/databases", async (req) =>
    serial(wsFor(req).root, () => listDatabases(wsFor(req))),
  );
  app.post("/api/databases", async (req) => {
    const ws = wsFor(req);
    const data = z
      .object({
        parent: filePath.default(""),
        name: nameSchema,
        viewType: z.enum(["table", "kanban", "calendar", "timeline"]),
      })
      .parse(req.body);
    await target(ws, data.parent);
    return serial(ws.root, () =>
      createDatabase(
        ws,
        data.parent,
        data.name,
        data.viewType as DatabaseViewType,
      ),
    );
  });
  app.put("/api/databases/manifest", async (req) => {
    const ws = wsFor(req);
    const data = z
      .object({ folderPath: userPath, manifest: z.unknown() })
      .parse(req.body);
    await target(ws, data.folderPath);
    return serial(ws.root, () =>
      updateManifest(ws, data.folderPath, data.manifest as DatabaseManifest),
    );
  });
  app.get("/api/databases/rows", async (req) => {
    const ws = wsFor(req);
    const { folderPath } = z.object({ folderPath: userPath }).parse(req.query);
    await target(ws, folderPath);
    const meta = (await listDatabases(ws)).find(
      (d) => d.folderPath === folderPath,
    );
    if (!meta) throw badRequest("Database not found");
    return databaseRows(ws, meta);
  });
  app.post("/api/databases/rows", async (req) => {
    const ws = wsFor(req);
    const data = z
      .object({
        folderPath: userPath,
        values: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(req.body);
    const meta = (await listDatabases(ws)).find(
      (d) => d.folderPath === data.folderPath,
    );
    if (!meta) throw badRequest("Database not found");
    return serial(ws.root, () => addDatabaseRow(ws, meta, data.values));
  });
  app.patch("/api/databases/cell", async (req) => {
    const ws = wsFor(req);
    const data = z
      .object({
        folderPath: userPath,
        rowId: z.string(),
        key: z.string().min(1),
        value: z.unknown().optional(),
      })
      .parse(req.body);
    const meta = (await listDatabases(ws)).find(
      (d) => d.folderPath === data.folderPath,
    );
    if (!meta) throw badRequest("Database not found");
    return serial(ws.root, () =>
      updateDatabaseCell(ws, meta, data.rowId, data.key, data.value),
    );
  });
  app.post("/api/databases/reorder", async (req) => {
    const ws = wsFor(req);
    const data = z
      .object({ folderPath: userPath, rowIds: z.array(z.string()).max(10000) })
      .parse(req.body);
    const meta = (await listDatabases(ws)).find(
      (d) => d.folderPath === data.folderPath,
    );
    if (!meta) throw badRequest("Database not found");
    await serial(ws.root, async () =>
      reorderDatabaseRows(ws, meta as DatabaseMeta, data.rowIds),
    );
    return { ok: true };
  });
  app.patch("/api/databases/row", async (req) => {
    const ws = wsFor(req);
    const data = z
      .object({ folderPath: userPath, rowId: z.string(), name: nameSchema })
      .parse(req.body);
    const meta = (await listDatabases(ws)).find(
      (d) => d.folderPath === data.folderPath,
    );
    if (!meta) throw badRequest("Database not found");
    return {
      fileName: await serial(ws.root, () =>
        renameDatabaseRow(ws, meta, data.rowId, data.name),
      ),
    };
  });
  app.get("/api/files/content", async (req) => {
    const ws = wsFor(req);
    const { path: p } = z.object({ path: filePath }).parse(req.query);
    await target(ws, p);
    const abs = await target(ws, p);
    const s = await stat(abs);
    if (!s.isFile()) throw badRequest("Not a regular file");
    let kind = kindFor(p);
    if (kind === "image" || kind === "pdf" || kind === "unsupported")
      return {
        kind,
        size: s.size,
        mtimeMs: Math.floor(s.mtimeMs),
        hash: "",
      } satisfies FileContent;
    const result = await readContent({ wsId: ws.wsId, path: p });
    if (result.viewKind === "unsupported") kind = "unsupported";
    else if (result.viewKind === "readonly") {
      if (kind !== "sheet" || result.size > CSV_EDIT_LIMITS.bytes)
        kind = "text";
    }
    return { ...result, kind } satisfies FileContent;
  });
  app.put("/api/files/content", async (req) => {
    const ws = wsFor(req);
    const data = WriteFileRequest.omit({ wsId: true, force: true })
      .extend({ path: userPath })
      .parse(req.body);
    const kind = kindFor(data.path);
    if (kind !== "editor" && kind !== "sheet")
      throw badRequest("Only Markdown and CSV are editable");
    if (kind === "sheet") {
      const validationError = validateCsvForEditing(data.content);
      if (validationError) throw badRequest(validationError);
    }
    await target(ws, data.path);
    return serial(ws.root, () => saveContent({ ...data, wsId: ws.wsId }));
  });
  app.get("/api/files/raw", async (req, reply) => {
    const { workspace, path: p } = z
      .object({ workspace: z.string(), path: filePath })
      .parse(req.query);
    const ws = getWorkspace(workspace);
    const abs = await target(ws, p);
    if (!["image", "pdf"].includes(kindFor(p)))
      throw badRequest("Preview is not supported");
    if (!(await stat(abs)).isFile()) throw badRequest("Not a file");
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
    return reply
      .type(mime[path.extname(p).toLowerCase()]!)
      .send(createReadStream(abs));
  });
  app.get("/_artifacts/:workspace/*", async (req, reply) => {
    const { workspace, "*": requestedPath } = z
      .object({ workspace: z.string(), "*": z.string() })
      .parse(req.params);
    const relativePath = filePath
      .refine((p) => !p.split("/").includes(".maek"), "Managed workspace path")
      .parse(requestedPath);
    const ws = getWorkspace(workspace);
    let abs = await target(ws, relativePath);
    let info = await stat(abs);
    if (info.isDirectory()) {
      abs = await target(ws, path.posix.join(relativePath, "index.html"));
      info = await stat(abs);
    }
    if (!info.isFile()) throw badRequest("Not a regular file");
    const extension = path.extname(abs).toLowerCase();
    const contentType = artifactMime[extension] ?? "application/octet-stream";
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "no-store");
    if (extension === ".html" || extension === ".htm") {
      reply.header(
        "Content-Security-Policy",
        "sandbox allow-scripts allow-same-origin allow-forms allow-downloads",
      );
    }
    return reply.type(contentType).send(createReadStream(abs));
  });
  app.post("/api/files", async (req) => {
    const ws = wsFor(req);
    const { dir, name, kind } = z
      .object({
        dir: filePath,
        name: nameSchema,
        kind: z.enum(["file", "dir"]),
      })
      .parse(req.body);
    if (dir.split("/").includes(".maek")) throw badRequest("Managed path");
    return serial(ws.root, async () => {
      const p = await unique(ws, dir, name);
      const abs = await target(ws, p);
      if (kind === "dir") await mkdir(abs);
      else {
        if (!["editor", "sheet"].includes(kindFor(p)))
          throw badRequest("New editable files must use .md or .csv");
        await writeFile(abs, "", { flag: "wx" });
      }
      return nodeFor(p, kind === "dir");
    });
  });
  app.patch("/api/files/path", async (req) => {
    const ws = wsFor(req);
    const { source, dest } = z
      .object({ source: userPath, dest: userPath })
      .parse(req.body);
    return serial(ws.root, async () => {
      const from = await target(ws, source);
      const to = await target(ws, dest);
      if (source === dest) return { source, dest };
      if (dest.startsWith(source + "/"))
        throw badRequest("Cannot move a folder into itself");
      if (await lstat(to).catch(() => null))
        throw conflict("changed", "Destination already exists");
      await rename(from, to);
      if ((await stat(to)).isDirectory())
        await databaseFolderMoved(ws, source, dest);
      return { source, dest };
    });
  });
  app.post("/api/files/copy", async (req) => {
    const ws = wsFor(req);
    const { paths, dir } = z
      .object({ paths: z.array(userPath).min(1).max(1000), dir: filePath })
      .parse(req.body);
    if (dir.split("/").includes(".maek")) throw badRequest("Managed path");
    return serial(ws.root, async () => {
      const created: FileNode[] = [];
      for (const source of paths) {
        if (dir === source || dir.startsWith(source + "/"))
          throw badRequest("Cannot copy a folder into itself");
        const dest = await unique(ws, dir, path.basename(source));
        await copyTree(ws, source, dest);
        created.push(
          nodeFor(dest, (await stat(await target(ws, dest))).isDirectory()),
        );
      }
      return created;
    });
  });
  app.post("/api/files/import", async (req) => {
    const ws = wsFor(req);
    const { dir, files } = z
      .object({
        dir: filePath,
        files: z
          .array(
            z.object({
              name: filePath.refine(
                (n) => !!n && !n.split("/").includes(".maek"),
              ),
              data: z.string().max(44 * 1024 * 1024),
            }),
          )
          .max(1000),
      })
      .parse(req.body);
    if (dir.split("/").includes(".maek")) throw badRequest("Managed path");
    return serial(ws.root, async () => {
      const out: FileNode[] = [];
      for (const f of files) {
        const nested = path.posix.join(dir, path.posix.dirname(f.name));
        await mkdir(await target(ws, nested), { recursive: true });
        const p = await unique(ws, nested, path.basename(f.name));
        await writeFile(await target(ws, p), Buffer.from(f.data, "base64"), {
          flag: "wx",
        });
        out.push(nodeFor(p, false));
      }
      return out;
    });
  });
  app.post("/api/files/image", async (req) => {
    const ws = wsFor(req);
    const { name, data } = z
      .object({ name: nameSchema, data: z.string().max(32 * 1024 * 1024) })
      .parse(req.body);
    if (kindFor(name) !== "image") throw badRequest("Not an image");
    return serial(ws.root, async () => {
      await mkdir(await target(ws, ".maek/assets"), { recursive: true });
      const p = await unique(ws, ".maek/assets", name);
      await writeFile(await target(ws, p), Buffer.from(data, "base64"), {
        flag: "wx",
      });
      return { path: p };
    });
  });
  app.delete("/api/files", async (req) => {
    const ws = wsFor(req);
    const { paths } = z
      .object({ paths: z.array(userPath).min(1).max(1000) })
      .parse(req.body);
    return serial(ws.root, async () => {
      for (const p of paths.filter(
        (p) => !paths.some((other) => p !== other && p.startsWith(other + "/")),
      )) {
        const abs = await target(ws, p);
        await lstat(abs);
        if (options.trash) await options.trash(abs);
        else {
          if (process.platform !== "darwin")
            throw badRequest("macOS is required");
          await run("osascript", [
            "-e",
            "on run argv",
            "-e",
            'tell application "Finder" to delete POSIX file (item 1 of argv)',
            "-e",
            "end run",
            "--",
            abs,
          ]);
        }
      }
      return { ok: true };
    });
  });
  app.post("/api/files/open-external", async (req) => {
    const ws = wsFor(req);
    const { path: p, reveal } = z
      .object({ path: userPath, reveal: z.boolean().optional() })
      .parse(req.body);
    const abs = await target(ws, p);
    await lstat(abs);
    if (options.open) await options.open(abs);
    else {
      if (process.platform !== "darwin") throw badRequest("macOS is required");
      await run("open", reveal ? ["-R", abs] : [abs]);
    }
    return { ok: true };
  });
  app.post("/api/run", async (req) => {
    const ws = wsFor(req);
    const {
      cmd,
      args,
      cwd: reqCwd,
    } = z
      .object({
        cmd: z.string().min(1),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
      })
      .parse(req.body);
    const cwd = reqCwd ? await resolveInWorkspace(ws, reqCwd) : ws.root;
    try {
      const { stdout, stderr } = await run(cmd, args, {
        cwd,
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      });
      return {
        stdout: stdout ? stdout.toString() : "",
        stderr: stderr ? stderr.toString() : "",
        exitCode: 0,
      };
    } catch (e: any) {
      return {
        stdout: e.stdout ? e.stdout.toString() : "",
        stderr: e.stderr ? e.stderr.toString() : String(e.message || e),
        exitCode: typeof e.code === "number" ? e.code : 1,
      };
    }
  });
  const rootTabsInput = z.object({
    tabs: z.array(filePath).max(200),
    activeTabId: filePath.nullable(),
  });
  const uiState = z.object({
    activeTabId: filePath.nullable(),
    scrollPositions: z.record(z.string(), z.number().min(0)),
    expanded: z.array(filePath),
    theme: z.enum(["light", "dark"]),
    sidebarWidth: z.number().min(180).max(600),
    split: z.object({ left: filePath.nullable(), right: filePath.nullable(), active: z.enum(["left", "right"]), ratio: z.number().min(0.25).max(0.75) }).optional(),
  });
  const uiStateFallback = {
    activeTabId: null,
    scrollPositions: {},
    expanded: [],
    theme: "light" as const,
    sidebarWidth: 260,
  };
  const readJson = async (abs: string): Promise<unknown> =>
    JSON.parse(await readFile(abs, "utf8"));

  // The open-tab list and order live in the workspace-root `.maek/tabs.json`
  // (original app "version 4" document), shared by every browser. The web app
  // reads only the tabs it can display and preserves everything else on write.
  app.get("/api/workspace/tabs", async (req) => {
    const ws = wsFor(req);
    try {
      const document = (await readJson(
        await metadata.path(ws, "tabs.json"),
      )) as RootTabsDocument;
      return readRootTabs(ws.root, document, true);
    } catch {
      // No root document yet: seed the shared list from this browser's own
      // legacy session file so an existing web workspace keeps its tabs. The
      // legacy file is migration input only and is never written back.
      try {
        const legacy = (await readJson(
          await metadata.path(ws, `sessions/web/${sessionFor(req)}/tabs.json`),
        )) as { tabs?: unknown; activeTabId?: unknown };
        const relative = (p: string) =>
          path.isAbsolute(p) ? path.relative(ws.root, p) : p;
        const entries = Array.isArray(legacy.tabs) ? legacy.tabs : [];
        const tabs = entries
          .map((t: unknown) =>
            typeof t === "string"
              ? relative(t)
              : relative(String((t as { id?: unknown }).id ?? "")),
          )
          .filter(
            (p: string) => p && !p.startsWith("..") && !path.isAbsolute(p),
          );
        const active =
          typeof legacy.activeTabId === "string"
            ? relative(legacy.activeTabId)
            : null;
        return {
          tabs,
          activeTabId: active && tabs.includes(active) ? active : null,
        };
      } catch {
        return { tabs: [], activeTabId: null };
      }
    }
  });
  app.put("/api/workspace/tabs", async (req) => {
    const ws = wsFor(req);
    const data = rootTabsInput.parse(req.body);
    return serial(ws.root, async () => {
      let existing: RootTabsDocument | null = null;
      try {
        existing = (await readJson(
          await metadata.path(ws, "tabs.json"),
        )) as RootTabsDocument;
      } catch {
        existing = null;
      }
      const merged = mergeRootTabs(
        ws.root,
        existing,
        data.tabs,
        data.activeTabId,
        true,
      );
      await metadata.writeJson(ws, "tabs.json", merged);
      return { ok: true };
    });
  });

  // Per-browser presentation state (theme, layout, selection, scroll). Never
  // shared through the root document.
  app.get("/api/workspace/ui-state", async (req) => {
    const ws = wsFor(req);
    const sessionDir = `sessions/web/${sessionFor(req)}`;
    const relative = (p: string) =>
      path.isAbsolute(p) ? path.relative(ws.root, p) : p;
    try {
      return uiState.parse(
        await readJson(await metadata.path(ws, `${sessionDir}/ui.json`)),
      );
    } catch {
      // Migrate from this browser's legacy session tabs.json (old Session).
      try {
        const legacy = (await readJson(
          await metadata.path(ws, `${sessionDir}/tabs.json`),
        )) as Partial<{
          activeTabId: string | null;
          scrollPositions: Record<string, number>;
          expanded: string[];
          theme: "light" | "dark";
          sidebarWidth: number;
        }>;
        const active =
          typeof legacy.activeTabId === "string"
            ? relative(legacy.activeTabId)
            : null;
        return uiState.parse({
          activeTabId: active && !active.startsWith("..") ? active : null,
          scrollPositions: Object.fromEntries(
            Object.entries(legacy.scrollPositions ?? {}).map(([p, v]) => [
              relative(p),
              v,
            ]),
          ),
          expanded: (legacy.expanded ?? [])
            .map(relative)
            .filter((p: string) => !p.startsWith("..")),
          theme: legacy.theme ?? "light",
          sidebarWidth: legacy.sidebarWidth ?? 260,
        });
      } catch {
        return uiStateFallback;
      }
    }
  });
  app.put("/api/workspace/ui-state", async (req) => {
    const ws = wsFor(req);
    const data = uiState.parse(req.body);
    const relativePath = `sessions/web/${sessionFor(req)}/ui.json`;
    return serial(ws.wsId + ":" + relativePath, async () => {
      await metadata.writeJson(ws, relativePath, data);
      return { ok: true };
    });
  });

  const recents = z
    .array(z.object({ path: filePath, lastOpened: z.number() }))
    .max(200);
  const appearance = z.object({
    version: z.number().default(1),
    folders: z.record(
      z.string(),
      z.object({ icon: z.string(), iconColor: z.string().default("accent") }),
    ),
  });
  for (const [route, name, schema] of [
    ["recent-files", "recentFiles.json", recents, []],
    ["folder-appearance", "folder-appearance.json", appearance, {}],
  ] as const) {
    app.get("/api/workspace/" + route, async (req) => {
      const ws = wsFor(req);
      if (route === "recent-files")
        return serial(ws.root, async () =>
          recentList(ws, await readRecents(ws)),
        );
      try {
        return appearance.parse(
          JSON.parse(await readFile(await metadata.path(ws, name), "utf8")),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return { version: 1, folders: {} };
        throw error;
      }
    });
    app.put("/api/workspace/" + route, async (req) => {
      const ws = wsFor(req);
      const data = schema.parse(req.body);
      return serial(ws.root, async () => {
        let stored: unknown = data;
        if (route === "recent-files") {
          stored = {
            version: 1,
            entries: Object.fromEntries(
              recents
                .parse(data)
                .map((f) => [
                  path.join(ws.root, f.path),
                  {
                    lastOpenedAt: f.lastOpened,
                    openCount: (f as { openCount?: number }).openCount ?? 1,
                  },
                ]),
            ),
          };
        } else if (route === "folder-appearance") {
          stored = appearance.parse(data);
        }
        const relativePath =
          route === "folder-appearance"
            ? name
            : `sessions/web/${sessionFor(req)}/${name}`;
        await metadata.writeJson(ws, relativePath, stored);
        return { ok: true };
      });
    });
  }
  app.get("/api/workspaces/events", async (req, reply) => {
    const { workspace } = z.object({ workspace: z.string() }).parse(req.query);
    const ws = getWorkspace(workspace);
    const hub = runtimes.get(ws).watcher;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (message: WorkspaceEvent) => {
      if (!reply.raw.destroyed)
        reply.raw.write(
          `id: ${message.id}\nevent: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`,
        );
    };
    let closed = false;
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": ping\n\n");
    }, 20000);
    const parsedLastEventId = Number(req.headers["last-event-id"]);
    const unsubscribe = hub.subscribe(
      send,
      Number.isSafeInteger(parsedLastEventId) && parsedLastEventId >= 0
        ? parsedLastEventId
        : undefined,
    );
    const close = async () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(close);
      reply.raw.end();
    };
    streams.add(close);
    reply.raw.on("close", () => void close());
  });
  return app;
}
