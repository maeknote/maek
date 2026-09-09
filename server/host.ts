import Fastify from "fastify";
import { z } from "zod";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  stat,
  lstat,
  rename,
  copyFile,
  unlink,
} from "node:fs/promises";
import { createReadStream, constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { watch } from "chokidar";
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
  PreviewKind,
  Change,
} from "../shared/workspace";

const run = promisify(execFile);
const ignored = new Set([
  ".maek",
  ".maek-data",
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  "coverage",
  ".venv",
  "venv",
  ".virtualenv",
  "virtualenv",
  "site-packages",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".ipynb_checkpoints",
  ".gradle",
  "Pods",
  ".terraform",
  ".cache",
  ".vscode",
  ".idea",
]);
const isIgnored = (p: string) =>
  p.split(path.sep).some((s) => ignored.has(s) || s.endsWith(".tmp"));
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
const mime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};
function kindFor(p: string): PreviewKind {
  const ext = path.extname(p).toLowerCase();
  return ext === ".md" || ext === ".markdown"
    ? "editor"
    : ext === ".pdf"
      ? "pdf"
      : mime[ext]?.startsWith("image/")
        ? "image"
        : [
              ".txt",
              ".json",
              ".yaml",
              ".yml",
              ".csv",
              ".log",
              ".css",
              ".js",
              ".ts",
              ".py",
              ".sh",
              ".xml",
              ".toml",
              ".ini",
            ].includes(ext)
          ? "text"
          : "unsupported";
}
const nodeFor = (p: string, isDir: boolean): FileNode => ({
  id: p,
  name: path.basename(p),
  parent: path.dirname(p) === "." ? null : path.dirname(p),
  isDir,
});
async function target(ws: Workspace, p: string) {
  const abs = await resolveInWorkspace(ws, p);
  let current = ws.root;
  for (const part of p.split("/").filter(Boolean)) {
    current = path.join(current, part);
    const s = await lstat(current).catch(() => null);
    if (s?.isSymbolicLink())
      throw badRequest("Symbolic links are not supported");
  }
  return abs;
}
async function scan(ws: Workspace) {
  const nodes: FileNode[] = [];
  const warnings: string[] = [];
  const pending = [""];
  while (pending.length) {
    const dir = pending.pop()!;
    const entries = await readdir(await target(ws, dir), {
      withFileTypes: true,
    }).catch(() => {
      warnings.push(dir);
      return [];
    });
    for (const e of entries) {
      const p = path.posix.join(dir, e.name);
      if (isIgnored(p) || (!e.isDirectory() && !e.isFile())) continue;
      nodes.push(nodeFor(p, e.isDirectory()));
      if (e.isDirectory()) pending.push(p);
    }
  }
  nodes.sort(
    (a, b) =>
      Number(b.isDir) - Number(a.isDir) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return { nodes, warnings };
}
async function atomic(abs: string, content: string) {
  const tmp = abs + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp, content, { flag: "wx", mode: 0o600 });
    await rename(tmp, abs);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
async function metadata(ws: Workspace, name: string) {
  const dir = await target(ws, ".maek");
  await mkdir(dir, { recursive: true });
  const config = await target(ws, ".maek/config.json");
  try {
    await writeFile(
      config,
      JSON.stringify(
        { version: 1, name: ws.name, createdAt: Date.now() },
        null,
        2,
      ),
      { flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const abs = await target(ws, ".maek/" + name);
  return abs;
}
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
  });
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host ?? "";
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
      return reply.code(403).send({ message: "Use the local address" });
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
  app.post("/api/workspaces/open", async (req) => {
    const { path: p } = z.object({ path: z.string().min(1) }).parse(req.body);
    const ws = await registerWorkspace(p);
    await metadata(ws, "tabs.json");
    return toRef(ws);
  });
  app.post("/api/workspaces/pick", async () => {
    const result = await (options.pick ?? pickDirectory)();
    if (result.status === "ok")
      await metadata(getWorkspace(result.workspace.wsId), "tabs.json");
    return result;
  });
  app.get("/api/tree", async (req) => scan(wsFor(req)));
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
  const workspaceRecents = z
    .array(z.object({ id: z.string(), path: z.string(), name: z.string() }))
    .max(30);
  app.get("/api/workspace/workspaces", async (req) => {
    try {
      return workspaceRecents.parse(
        JSON.parse(
          await readFile(await metadata(wsFor(req), "workspaces.json"), "utf8"),
        ),
      );
    } catch {
      return [];
    }
  });
  app.put("/api/workspace/workspaces", async (req) => {
    const ws = wsFor(req);
    const data = workspaceRecents.parse(req.body);
    return serial(ws.wsId, async () => {
      await atomic(
        await metadata(ws, "workspaces.json"),
        JSON.stringify(data, null, 2),
      );
      return { ok: true };
    });
  });
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
  ] as const) {
    app.get("/api/workspace/" + route, async (req) => {
      const ws = wsFor(req);
      const abs = await metadata(ws, name);
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
        return schema.parse(stored);
      } catch {
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
        } else {
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
        }
        await atomic(await metadata(ws, name), JSON.stringify(stored, null, 2));
        return { ok: true };
      });
    });
  }
  app.get("/api/workspaces/events", async (req, reply) => {
    const { workspace } = z.object({ workspace: z.string() }).parse(req.query);
    const ws = getWorkspace(workspace);
    const watcher = watch(ws.root, {
      ignoreInitial: false,
      alwaysStat: true,
      followSymlinks: false,
      ignored: (p) => isIgnored(path.relative(ws.root, p)),
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => {
      if (!reply.raw.destroyed)
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("ready", {});
    let initialized = false;
    const identities = new Map<string, number>();
    const removed = new Map<
      string,
      { ino: number | undefined; timer: ReturnType<typeof setTimeout> }
    >();
    const relocated = new Set<string>();
    let closed = false;
    const heartbeat = setInterval(() => send("ping", {}), 20000);
    const close = async () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      for (const r of removed.values()) clearTimeout(r.timer);
      streams.delete(close);
      await watcher.close();
      reply.raw.end();
    };
    streams.add(close);
    reply.raw.on("close", () => void close());
    watcher.on("ready", () => {
      initialized = true;
      send("rescan", {});
    });
    watcher.on("all", (type, abs, stats) => {
      if (!["add", "change", "unlink", "addDir", "unlinkDir"].includes(type))
        return;
      const p = path.relative(ws.root, abs);
      if (!p || isIgnored(p)) return;
      const ino = stats?.ino;
      if (!initialized) {
        if (ino) identities.set(p, ino);
        return;
      }
      if (type === "unlink" || type === "unlinkDir") {
        const previous = identities.get(p);
        identities.delete(p);
        if (relocated.delete(p)) return;
        const timer = setTimeout(() => {
          removed.delete(p);
          send("change", { type, path: p });
        }, 180);
        removed.set(p, { ino: previous, timer });
        return;
      }
      if ((type === "add" || type === "addDir") && ino) {
        const old = [...removed].find(([old, r]) => old !== p && r.ino === ino);
        const existing =
          old?.[0] ??
          [...identities].find(([old, id]) => old !== p && id === ino)?.[0];
        if (existing) {
          if (old) {
            clearTimeout(old[1].timer);
            removed.delete(existing);
          } else relocated.add(existing);
          identities.delete(existing);
          identities.set(p, ino);
          send("change", {
            type: "rename",
            source: existing,
            path: p,
            node: nodeFor(p, type === "addDir"),
          });
          return;
        }
      }
      if (ino) identities.set(p, ino);
      const event: Change = {
        type: type as Change["type"],
        path: p,
        ...(type === "add" || type === "addDir"
          ? { node: nodeFor(p, type === "addDir") }
          : {}),
      };
      send("change", event);
    });
    watcher.on("error", () => {
      send("watch-error", {});
      void close();
    });
  });
  return app;
}
