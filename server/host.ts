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
    else if (result.viewKind === "readonly") kind = "text";
    return { ...result, kind } satisfies FileContent;
  });
  app.put("/api/files/content", async (req) => {
    const ws = wsFor(req);
    const data = WriteFileRequest.omit({ wsId: true, force: true })
      .extend({ path: userPath })
      .parse(req.body);
    if (kindFor(data.path) !== "editor")
      throw badRequest("Only Markdown is editable");
    await target(ws, data.path);
    return serial(ws.wsId, () => saveContent({ ...data, wsId: ws.wsId }));
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
    return serial(ws.wsId, async () => {
      const p = await unique(ws, dir, name);
      const abs = await target(ws, p);
      if (kind === "dir") await mkdir(abs);
      else {
        if (kindFor(p) !== "editor") throw badRequest("New notes must use .md");
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
    return serial(ws.wsId, async () => {
      const from = await target(ws, source);
      const to = await target(ws, dest);
      if (source === dest) return { source, dest };
      if (dest.startsWith(source + "/"))
        throw badRequest("Cannot move a folder into itself");
      if (await lstat(to).catch(() => null))
        throw conflict("changed", "Destination already exists");
      await rename(from, to);
      return { source, dest };
    });
  });
  app.post("/api/files/copy", async (req) => {
    const ws = wsFor(req);
    const { paths, dir } = z
      .object({ paths: z.array(userPath).min(1).max(1000), dir: filePath })
      .parse(req.body);
    if (dir.split("/").includes(".maek")) throw badRequest("Managed path");
    return serial(ws.wsId, async () => {
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
    return serial(ws.wsId, async () => {
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
    return serial(ws.wsId, async () => {
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
    return serial(ws.wsId, async () => {
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
    const { cmd, args, cwd: reqCwd } = z
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
  const session = z.object({
    tabs: z.array(filePath).max(200),
    activeTabId: filePath.nullable(),
    scrollPositions: z.record(z.string(), z.number().min(0)),
    expanded: z.array(filePath),
    theme: z.enum(["light", "dark"]),
    sidebarWidth: z.number().min(180).max(600),
  });
  const recents = z
    .array(z.object({ path: filePath, lastOpened: z.number() }))
    .max(200);
  const appearance = z.record(z.string(), z.string());
  for (const [route, name, schema, fallback] of [
    [
      "tabs",
      "tabs.json",
      session,
      {
        tabs: [],
        activeTabId: null,
        scrollPositions: {},
        expanded: [],
        theme: "light",
        sidebarWidth: 260,
      },
    ],
    ["recent-files", "recentFiles.json", recents, []],
    ["folder-appearance", "folderAppearance.json", appearance, {}],
  ] as const) {
    app.get("/api/workspace/" + route, async (req) => {
      const ws = wsFor(req);
      const abs = await metadata.path(
        ws,
        `sessions/web/${sessionFor(req)}/${name}`,
      );
      try {
        const stored = JSON.parse(await readFile(abs, "utf8"));
        const relative = (p: string) =>
          path.isAbsolute(p) ? path.relative(ws.root, p) : p;
        if (route === "tabs" && typeof stored.version === "number") {
          return session.parse({
            ...fallback,
            ...stored,
            tabs: stored.tabs
              .filter(
                (t: { viewKind?: string }) =>
                  !["database", "meeting", "workspace-settings"].includes(
                    t.viewKind ?? "",
                  ),
              )
              .map((t: { id: string }) => relative(t.id))
              .filter((p: string) => !p.startsWith("..")),
            activeTabId: stored.activeTabId
              ? relative(stored.activeTabId)
              : null,
          });
        }
        if (route === "recent-files" && stored.version === 1)
          return recents.parse(
            Object.entries(stored.entries)
              .map(([p, v]) => ({
                path: relative(p),
                lastOpened: (v as { lastOpenedAt: number }).lastOpenedAt,
              }))
              .filter((f) => !f.path.startsWith(".."))
              .slice(0, 200),
          );
        if (route === "folder-appearance") return appearance.parse(stored);
        return schema.parse(stored);
      } catch {
        // Legacy desktop metadata is migration input only. The browser never
        // writes these files, so both applications can use the same workspace.
        try {
          const stored = JSON.parse(
            await readFile(await metadata.path(ws, name), "utf8"),
          );
          const relative = (p: string) =>
            path.isAbsolute(p) ? path.relative(ws.root, p) : p;
          if (route === "tabs" && typeof stored.version === "number") {
            return session.parse({
              ...fallback,
              ...stored,
              tabs: stored.tabs
                .filter(
                  (tab: { viewKind?: string }) =>
                    !["database", "meeting", "workspace-settings"].includes(
                      tab.viewKind ?? "",
                    ),
                )
                .map((tab: { id: string }) => relative(tab.id))
                .filter((p: string) => !p.startsWith("..")),
              activeTabId: stored.activeTabId
                ? relative(stored.activeTabId)
                : null,
            });
          }
          if (route === "recent-files" && stored.version === 1) {
            return recents.parse(
              Object.entries(stored.entries)
                .map(([p, value]) => ({
                  path: relative(p),
                  lastOpened: (value as { lastOpenedAt: number }).lastOpenedAt,
                }))
                .filter((file) => !file.path.startsWith(".."))
                .slice(0, 200),
            );
          }
          if (route === "folder-appearance") return appearance.parse(stored);
        } catch {
          // A missing or corrupt legacy file is equivalent to an empty session.
        }
        return fallback;
      }
    });
    app.put("/api/workspace/" + route, async (req) => {
      const ws = wsFor(req);
      const data = schema.parse(req.body);
      return serial(ws.wsId, async () => {
        let stored: unknown = data;
        if (route === "tabs") {
          const s = session.parse(data);
          stored = {
            ...s,
            version: 4,
            activeTabId: s.activeTabId
              ? path.join(ws.root, s.activeTabId)
              : null,
            tabs: s.tabs.map((p) => ({
              id: path.join(ws.root, p),
              name: path.basename(p),
              parentName: path.basename(path.dirname(p)),
              isEphemeral: false,
              viewKind:
                kindFor(p) === "editor"
                  ? "editor"
                  : kindFor(p) === "unsupported"
                    ? "unsupported"
                    : "preview",
            })),
          };
        } else if (route === "recent-files") {
          stored = {
            version: 1,
            entries: Object.fromEntries(
              recents
                .parse(data)
                .map((f) => [
                  path.join(ws.root, f.path),
                  { lastOpenedAt: f.lastOpened, openCount: 1 },
                ]),
            ),
          };
        } else if (route === "folder-appearance") {
          stored = appearance.parse(data);
        }
        await metadata.writeJson(
          ws,
          `sessions/web/${sessionFor(req)}/${name}`,
          stored,
        );
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
