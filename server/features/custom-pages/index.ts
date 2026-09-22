import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  CustomPageManifest,
  type CustomPageMountResult,
  type CustomPageResource,
  type CustomPageTransactionResult,
} from "../../../shared/custom-page";
import type { ErrorCode } from "../../../shared/contract";
import { badRequest, conflict, fsError, RpcHttpError } from "../../core/errors";
import { resolveInWorkspace, toRelPath } from "../../core/fs/guard";
import { artifactMime } from "../../workspace/file-kind";
import { getWorkspace, type Workspace } from "../../workspaces";

type Serial = <T>(key: string, task: () => Promise<T>) => Promise<T>;

interface CustomPageOptions {
  serial: Serial;
  invalidate: (workspace: Workspace) => void;
}

interface ResolvedResource {
  name: string;
  relativePath: string;
  absolutePath: string;
  definition: CustomPageResource;
}

interface PageMount {
  mountId: string;
  workspace: Workspace;
  manifest: CustomPageManifest;
  assetsRoot: string;
  assetsRootReal: string;
  entry: string;
  resources: Map<string, ResolvedResource>;
}

const entryInput = z.object({
  entry: z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (value) =>
        !value.includes("\0") &&
        !value.includes("\\") &&
        !value.startsWith("/") &&
        !value
          .split("/")
          .some((segment) => segment === ".." || segment === ".maek"),
      "Invalid custom page entry",
    ),
});
const mountParams = z.object({ mount: z.string().min(20).max(80) });
const resourceParams = mountParams.extend({
  resource: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
});
const transactionInput = z.object({
  writes: z
    .array(
      z.object({
        resource: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        baseVersion: z.string().min(1).max(128),
        content: z.unknown(),
      }),
    )
    .min(1)
    .max(16),
});

const safeRequestPath = z
  .string()
  .max(4096)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.includes("\\") &&
      !value.startsWith("/") &&
      !value
        .split("/")
        .some((segment) => segment === ".." || segment === ".maek"),
    "Invalid custom page path",
  );

function sha256(bytes: Buffer): string {
  return `"sha256-${createHash("sha256").update(bytes).digest("hex")}"`;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function posixJoin(base: string, relative: string): string {
  return path.posix.normalize(path.posix.join(base, relative));
}

function pageError(
  status: number,
  code: ErrorCode,
  message: string,
): RpcHttpError {
  return new RpcHttpError(status, code, message);
}

async function existingFile(candidate: string): Promise<boolean> {
  return (await lstat(candidate).catch(() => null))?.isFile() === true;
}

async function findManifest(
  workspace: Workspace,
  entry: string,
): Promise<{ manifest: CustomPageManifest; absolutePath: string } | null> {
  const entryAbsolute = await resolveInWorkspace(workspace, entry);
  if (!(await stat(entryAbsolute)).isFile()) throw badRequest("Not a file");
  const candidates = [
    `${entryAbsolute}.maek.json`,
    path.join(path.dirname(entryAbsolute), "maek.page.json"),
  ];
  const absolutePath =
    (await Promise.all(
      candidates.map(async (candidate) =>
        (await existingFile(candidate)) ? candidate : null,
      ),
    )).find((candidate): candidate is string => candidate !== null) ?? null;
  if (!absolutePath) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw badRequest(
      `Invalid custom page manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { manifest: CustomPageManifest.parse(parsed), absolutePath };
}

async function createMount(
  workspace: Workspace,
  entry: string,
): Promise<PageMount | null> {
  const found = await findManifest(workspace, entry);
  if (!found) return null;
  const manifestDirectory = path.dirname(found.absolutePath);
  const manifestDirectoryRelative = toRelPath(workspace, manifestDirectory);
  const manifestEntry = posixJoin(
    manifestDirectoryRelative,
    found.manifest.entry,
  );
  if (manifestEntry !== entry)
    throw badRequest("Custom page manifest entry does not match this HTML file");

  const assetsRootRelative = posixJoin(
    manifestDirectoryRelative,
    found.manifest.assetsRoot,
  );
  const assetsRoot = await resolveInWorkspace(workspace, assetsRootRelative);
  if (!(await stat(assetsRoot)).isDirectory())
    throw badRequest("Custom page assetsRoot is not a directory");
  const assetsRootReal = await realpath(assetsRoot);
  const entryAbsolute = await resolveInWorkspace(workspace, manifestEntry);
  const entryReal = await realpath(entryAbsolute);
  if (!isInside(assetsRootReal, entryReal))
    throw badRequest("Custom page entry is outside assetsRoot");

  const resources = new Map<string, ResolvedResource>();
  for (const [name, definition] of Object.entries(found.manifest.resources)) {
    const relativePath = posixJoin(
      manifestDirectoryRelative,
      definition.path,
    );
    const absolutePath = await resolveInWorkspace(workspace, relativePath);
    const info = await lstat(absolutePath).catch((error) => {
      throw fsError(error, `Custom page resource ${name}`);
    });
    if (!info.isFile()) throw badRequest(`${name} is not a regular file`);
    if (info.size > definition.maxBytes)
      throw pageError(413, "too_large", `${name} exceeds its size limit`);
    resources.set(name, { name, relativePath, absolutePath, definition });
  }

  return {
    mountId: randomBytes(24).toString("base64url"),
    workspace,
    manifest: found.manifest,
    assetsRoot,
    assetsRootReal,
    entry: entryAbsolute,
    resources,
  };
}

function workspaceFor(req: { headers: Record<string, unknown> }): Workspace {
  return getWorkspace(z.string().parse(req.headers["x-workspace-id"]));
}

function customPageHost(req: FastifyRequest): void {
  const host = req.headers.host ?? "";
  if (!/^localhost(?::\d+)?$/.test(host))
    throw pageError(403, "forbidden", "Custom pages use the localhost origin");
}

function mountOrThrow(
  mounts: Map<string, PageMount>,
  mountId: string,
): PageMount {
  const mount = mounts.get(mountId);
  if (!mount) throw pageError(404, "mount_not_found", "Custom page mount not found");
  return mount;
}

function resourceOrThrow(mount: PageMount, name: string): ResolvedResource {
  const resource = mount.resources.get(name);
  if (!resource)
    throw pageError(404, "resource_not_found", `Unknown resource: ${name}`);
  return resource;
}

async function readResource(mount: PageMount, resource: ResolvedResource) {
  // Re-check on every operation. A resource can be replaced after mount, and
  // retaining only the formerly-safe absolute path would allow a later
  // symlink swap to escape the workspace. Data resources are regular files;
  // unlike static assets, symlinks are deliberately not part of this API.
  await resolveInWorkspace(mount.workspace, resource.relativePath);
  const info = await lstat(resource.absolutePath).catch((error) => {
    throw fsError(error, resource.relativePath);
  });
  if (!info.isFile())
    throw badRequest(`${resource.name} is not a regular file`);
  const bytes = await readFile(resource.absolutePath).catch((error) => {
    throw fsError(error, resource.relativePath);
  });
  if (bytes.length > resource.definition.maxBytes)
    throw pageError(413, "too_large", `${resource.name} exceeds its size limit`);
  if (resource.definition.format === "json") {
    try {
      JSON.parse(bytes.toString("utf8"));
    } catch {
      throw pageError(422, "invalid_json", `${resource.name} is not valid JSON`);
    }
  }
  return { bytes, version: sha256(bytes), mode: info.mode & 0o777 };
}

function encodeContent(resource: ResolvedResource, content: unknown): Buffer {
  let text: string;
  if (resource.definition.format === "json") {
    if (typeof content !== "object" || content === null)
      throw pageError(422, "invalid_json", `${resource.name} must be a JSON value`);
    text = JSON.stringify(content, null, 2) + "\n";
  } else {
    if (typeof content !== "string")
      throw pageError(422, "invalid_text", `${resource.name} must be text`);
    text = content;
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > resource.definition.maxBytes)
    throw pageError(413, "too_large", `${resource.name} exceeds its size limit`);
  return bytes;
}

async function backupResource(
  mount: PageMount,
  resource: ResolvedResource,
  bytes: Buffer,
): Promise<void> {
  const keep = resource.definition.backup.keep;
  if (keep === 0) return;
  const directory = await resolveInWorkspace(
    mount.workspace,
    `.maek/custom-page-backups/${mount.manifest.id}/${resource.name}`,
  );
  await mkdir(directory, { recursive: true });
  const backupPath = path.join(
    directory,
    `${Date.now()}-${randomUUID()}${path.extname(resource.absolutePath)}`,
  );
  await writeFile(backupPath, bytes, { flag: "wx", mode: 0o600 });
  const files = (await readdir(directory)).sort();
  await Promise.all(
    files.slice(0, Math.max(0, files.length - keep)).map((file) =>
      unlink(path.join(directory, file)).catch(() => {}),
    ),
  );
}

async function commitWrites(
  mount: PageMount,
  input: z.infer<typeof transactionInput>,
  options: CustomPageOptions,
): Promise<CustomPageTransactionResult> {
  const names = input.writes.map((write) => write.resource);
  if (new Set(names).size !== names.length)
    throw badRequest("A transaction cannot write the same resource twice");

  return options.serial(mount.workspace.root, async () => {
    const prepared = [] as Array<{
      resource: ResolvedResource;
      original: Buffer;
      next: Buffer;
      tempPath: string;
      mode: number;
    }>;
    for (const write of input.writes) {
      const resource = resourceOrThrow(mount, write.resource);
      if (resource.definition.access !== "read-write")
        throw pageError(403, "read_only", `${resource.name} is read-only`);
      const current = await readResource(mount, resource);
      if (current.version !== write.baseVersion)
        throw conflict("changed", `${resource.name} changed after it was read`);
      prepared.push({
        resource,
        original: current.bytes,
        next: encodeContent(resource, write.content),
        tempPath: `${resource.absolutePath}.${randomUUID()}.tmp`,
        mode: current.mode,
      });
    }

    const committed: typeof prepared = [];
    try {
      for (const item of prepared) {
        await writeFile(item.tempPath, item.next, {
          flag: "wx",
          mode: item.mode,
        });
        await chmod(item.tempPath, item.mode);
      }
      for (const item of prepared)
        await backupResource(mount, item.resource, item.original);
      for (const item of prepared) {
        await rename(item.tempPath, item.resource.absolutePath);
        committed.push(item);
      }
    } catch (error) {
      for (const item of committed.reverse()) {
        const restore = `${item.resource.absolutePath}.${randomUUID()}.restore`;
        await writeFile(restore, item.original, { flag: "wx", mode: item.mode });
        await rename(restore, item.resource.absolutePath).catch(async () => {
          await unlink(restore).catch(() => {});
        });
      }
      throw error;
    } finally {
      await Promise.all(prepared.map((item) => unlink(item.tempPath).catch(() => {})));
    }

    options.invalidate(mount.workspace);
    return {
      ok: true,
      versions: Object.fromEntries(
        prepared.map((item) => [item.resource.name, sha256(item.next)]),
      ),
    };
  });
}

function pageHeaders(reply: FastifyReply, html: boolean): void {
  reply.header("Cache-Control", "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  if (html)
    reply.header(
      "Content-Security-Policy",
      "sandbox allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox; connect-src 'self'; object-src 'none'; base-uri 'self'",
    );
}

export function registerCustomPages(
  app: FastifyInstance,
  options: CustomPageOptions,
): void {
  const mounts = new Map<string, PageMount>();

  app.addHook("preClose", async () => {
    mounts.clear();
  });

  app.post("/api/custom-pages/mount", async (req) => {
    const workspace = workspaceFor(req);
    const { entry } = entryInput.parse(req.body);
    const mount = await createMount(workspace, entry);
    if (!mount) return { kind: "static" } satisfies CustomPageMountResult;
    mounts.set(mount.mountId, mount);
    return {
      kind: "custom-page",
      mountId: mount.mountId,
      mountPath: `/_pages/${mount.mountId}/`,
      pageId: mount.manifest.id,
      title: mount.manifest.title,
    } satisfies CustomPageMountResult;
  });

  app.delete<{ Params: { mount: string } }>(
    "/api/custom-pages/mount/:mount",
    async (req) => {
      const workspace = workspaceFor(req);
      const { mount: mountId } = mountParams.parse(req.params);
      const mount = mounts.get(mountId);
      if (mount?.workspace.wsId === workspace.wsId) mounts.delete(mountId);
      return { ok: true };
    },
  );

  app.get<{ Params: { mount: string } }>(
    "/_pages/:mount/_api/health",
    async (req) => {
      customPageHost(req);
      const { mount: mountId } = mountParams.parse(req.params);
      const mount = mountOrThrow(mounts, mountId);
      return {
        ok: true,
        apiVersion: 1,
        pageId: mount.manifest.id,
        writable: [...mount.resources.values()].some(
          (resource) => resource.definition.access === "read-write",
        ),
      };
    },
  );

  app.get<{ Params: { mount: string; resource: string } }>(
    "/_pages/:mount/_api/resources/:resource",
    async (req, reply) => {
      customPageHost(req);
      const { mount: mountId, resource: name } = resourceParams.parse(req.params);
      const mount = mountOrThrow(mounts, mountId);
      const resource = resourceOrThrow(mount, name);
      const result = await readResource(mount, resource);
      reply.header("Cache-Control", "no-store");
      reply.header("ETag", result.version);
      return reply
        .type(
          resource.definition.format === "json"
            ? "application/json; charset=utf-8"
            : "text/plain; charset=utf-8",
        )
        .send(result.bytes);
    },
  );

  app.put<{ Params: { mount: string; resource: string } }>(
    "/_pages/:mount/_api/resources/:resource",
    async (req, reply) => {
      customPageHost(req);
      const { mount: mountId, resource } = resourceParams.parse(req.params);
      const data = z
        .object({ baseVersion: z.string(), content: z.unknown() })
        .parse(req.body);
      const result = await commitWrites(
        mountOrThrow(mounts, mountId),
        { writes: [{ resource, ...data }] },
        options,
      );
      return reply.send(result);
    },
  );

  app.post<{ Params: { mount: string } }>(
    "/_pages/:mount/_api/transaction",
    async (req) => {
      customPageHost(req);
      const { mount: mountId } = mountParams.parse(req.params);
      return commitWrites(
        mountOrThrow(mounts, mountId),
        transactionInput.parse(req.body),
        options,
      );
    },
  );

  const serveAsset = async (
    req: FastifyRequest<{ Params: { mount: string; "*"?: string } }>,
    reply: FastifyReply,
    entry: boolean,
  ) => {
    customPageHost(req);
    const { mount: mountId } = mountParams.parse(req.params);
    const mount = mountOrThrow(mounts, mountId);
    let absolutePath = mount.entry;
    if (!entry) {
      const requested = safeRequestPath.parse(req.params["*"] ?? "");
      if (
        !requested ||
        requested === "_api" ||
        requested.startsWith("_api/") ||
        requested === "maek.page.json" ||
        requested.endsWith(".maek.json")
      )
        throw pageError(404, "not_found", "Page asset not found");
      absolutePath = await resolveInWorkspace(
        mount.workspace,
        posixJoin(toRelPath(mount.workspace, mount.assetsRoot), requested),
      );
      const info = await stat(absolutePath);
      if (info.isDirectory()) absolutePath = path.join(absolutePath, "index.html");
      const resolved = await realpath(absolutePath).catch((error) => {
        throw fsError(error, requested);
      });
      if (!isInside(mount.assetsRootReal, resolved))
        throw pageError(403, "forbidden", "Page asset is outside assetsRoot");
    }
    const info = await stat(absolutePath);
    if (!info.isFile()) throw badRequest("Not a regular file");
    const extension = path.extname(absolutePath).toLowerCase();
    pageHeaders(reply, extension === ".html" || extension === ".htm");
    return reply
      .type(artifactMime[extension] ?? "application/octet-stream")
      .send(createReadStream(absolutePath));
  };

  app.get<{ Params: { mount: string } }>("/_pages/:mount/", (req, reply) =>
    serveAsset(req, reply, true),
  );
  app.get<{ Params: { mount: string; "*": string } }>(
    "/_pages/:mount/*",
    (req, reply) => serveAsset(req, reply, false),
  );
}
