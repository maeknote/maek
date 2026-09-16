import Database from "better-sqlite3";
import path from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Workspace } from "./workspaces";
import type {
  DatabaseColumnSchema,
  DatabaseManifest,
  DatabaseMeta,
  DatabaseRow,
  DatabaseViewDefinition,
  DatabaseViewType,
} from "../shared/database";
import {
  composeMarkdownFile,
  parseYamlData,
  patchYamlField,
  renameYamlField,
  serializeYamlData,
  splitFrontmatterFile,
} from "../shared/frontmatter";
import { sha256, flooredMtime } from "./fs/readFile";
import { writeFile } from "./fs/writeFile";
import { conflict } from "./errors";

interface RawRow {
  id:string; database_id:string; file_name:string; yaml_data:string; file_mtime:number;
  sort_order:number; created_at:number; updated_at:number;
}
interface RawDatabase {
  id:string;folder_path:string;name:string;schema_json:string;view_type:DatabaseViewType;
  view_config_json:string|null;views_json:string|null;active_view_id:string|null;created_at:number;updated_at:number;
}
const MANIFEST = ".maek-database.json";
const dbs = new Map<string, Database.Database>();

function openDb(ws: Workspace) {
  const cached = dbs.get(ws.root);
  if (cached) return cached;
  const db = new Database(path.join(ws.root, ".maek", "database.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS databases (id TEXT PRIMARY KEY, folder_path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, schema_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, view_type TEXT NOT NULL DEFAULT 'table', view_config_json TEXT, views_json TEXT, active_view_id TEXT);
    CREATE TABLE IF NOT EXISTS database_rows (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, file_name TEXT NOT NULL, yaml_data TEXT NOT NULL DEFAULT '{}', file_mtime INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(database_id) REFERENCES databases(id) ON DELETE CASCADE);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rows_db_file ON database_rows(database_id,file_name);`);
  const databaseColumns = new Set(
    (db.pragma("table_info(databases)") as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!databaseColumns.has("view_type"))
    db.exec(
      "ALTER TABLE databases ADD COLUMN view_type TEXT NOT NULL DEFAULT 'table'",
    );
  if (!databaseColumns.has("view_config_json"))
    db.exec("ALTER TABLE databases ADD COLUMN view_config_json TEXT");
  if (!databaseColumns.has("views_json"))
    db.exec("ALTER TABLE databases ADD COLUMN views_json TEXT");
  if (!databaseColumns.has("active_view_id"))
    db.exec("ALTER TABLE databases ADD COLUMN active_view_id TEXT");
  const rowColumns = new Set(
    (db.pragma("table_info(database_rows)") as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!rowColumns.has("sort_order"))
    db.exec(
      "ALTER TABLE database_rows ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    );
  dbs.set(ws.root, db);
  return db;
}
const viewName: Record<DatabaseViewType, string> = {
  table: "Table",
  kanban: "Kanban",
  calendar: "Calendar",
  timeline: "Timeline",
};
function viewConfig(type: DatabaseViewType, schema: DatabaseColumnSchema[]) {
  const state = {
    sort: [],
    filter: { combinator: "and" as const, conditions: [] },
  };
  if (type === "kanban")
    return {
      ...state,
      groupColumnId: schema.find((c) => c.type === "select")?.id ?? null,
    };
  if (type === "calendar")
    return {
      ...state,
      dateColumnId:
        schema.find((c) => c.type === "date" || c.type === "date-range")?.id ??
        null,
    };
  if (type === "timeline")
    return {
      ...state,
      dateColumnId:
        schema.find((c) => c.type === "date" || c.type === "date-range")?.id ??
        null,
      zoom: "week" as const,
    };
  return state;
}
export function defaultSchema(type: DatabaseViewType): DatabaseColumnSchema[] {
  const text = (): DatabaseColumnSchema => ({
    id: randomUUID(),
    name: "Content",
    type: "text",
    order: 1,
  });
  if (type === "kanban")
    return [
      {
        id: randomUUID(),
        name: "Status",
        type: "select",
        order: 0,
        options: ["To Do", "In Progress", "Done"],
      },
      text(),
    ];
  if (type === "calendar")
    return [{ id: randomUUID(), name: "Date", type: "date", order: 0 }, text()];
  if (type === "timeline")
    return [
      { id: randomUUID(), name: "Period", type: "date-range", order: 0 },
      text(),
    ];
  return [{ ...text(), order: 0 }];
}
function validManifest(v: unknown): v is DatabaseManifest {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const x = v as Record<string, unknown>;
  const nonEmpty = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const columnTypes = new Set([
    "text",
    "number",
    "boolean",
    "date",
    "date-range",
    "select",
    "multi-select",
    "list",
  ]);
  const viewTypes = new Set(["table", "kanban", "calendar", "timeline"]);
  if (
    x.version !== 1 ||
    x.type !== "database" ||
    !nonEmpty(x.id) ||
    !nonEmpty(x.name) ||
    !nonEmpty(x.activeViewId) ||
    !finite(x.createdAt) ||
    !finite(x.updatedAt) ||
    !Array.isArray(x.schema) ||
    !Array.isArray(x.views) ||
    x.views.length === 0
  )
    return false;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const column of x.schema) {
    if (!column || typeof column !== "object" || Array.isArray(column))
      return false;
    const c = column as Record<string, unknown>;
    if (
      !nonEmpty(c.id) ||
      ids.has(c.id) ||
      !nonEmpty(c.name) ||
      !columnTypes.has(String(c.type)) ||
      !finite(c.order)
    )
      return false;
    if (names.has(c.name)) return false;
    names.add(c.name);
    ids.add(c.id);
    if (
      c.options !== undefined &&
      (!Array.isArray(c.options) ||
        !c.options.every((option) => typeof option === "string"))
    )
      return false;
  }
  const viewIds = new Set<string>();
  for (const view of x.views) {
    if (!view || typeof view !== "object" || Array.isArray(view)) return false;
    const item = view as Record<string, unknown>;
    if (
      !nonEmpty(item.id) ||
      viewIds.has(item.id) ||
      !nonEmpty(item.name) ||
      !viewTypes.has(String(item.type)) ||
      !item.config ||
      typeof item.config !== "object" ||
      Array.isArray(item.config) ||
      !finite(item.createdAt) ||
      !finite(item.updatedAt)
    )
      return false;
    viewIds.add(item.id);
  }
  return viewIds.has(x.activeViewId);
}
async function readManifest(folder: string) {
  try {
    const v = JSON.parse(await readFile(path.join(folder, MANIFEST), "utf8"));
    return validManifest(v) ? v : null;
  } catch {
    return null;
  }
}
async function writeManifest(folder: string, value: DatabaseManifest) {
  const {folderPath: _folder,viewType: _type,viewConfig: _config,viewState: _state,...stored}=value as DatabaseMeta;
  const target = path.join(folder, MANIFEST),
    tmp = target + `.` + randomUUID() + `.tmp`;
  try {
    await fsWriteFile(tmp, JSON.stringify(stored, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    await rename(tmp, target);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}
async function find(root: string) {
  const out: string[] = [];
  const pending = [root];
  const ignored = new Set([
    ".git",
    ".maek",
    ".codex",
    ".claude",
    "node_modules",
    "dist",
  ]);
  while (pending.length) {
    const dir = pending.pop()!;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      if (e.isFile() && e.name === MANIFEST) out.push(dir);
      else if (e.isDirectory() && !ignored.has(e.name))
        pending.push(path.join(dir, e.name));
    }
  }
  return out;
}
function upsertMeta(db: Database.Database, meta: DatabaseMeta) {
  db.prepare(
    `INSERT INTO databases(id,folder_path,name,schema_json,created_at,updated_at,view_type,view_config_json,views_json,active_view_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET folder_path=excluded.folder_path,name=excluded.name,schema_json=excluded.schema_json,updated_at=excluded.updated_at,view_type=excluded.view_type,view_config_json=excluded.view_config_json,views_json=excluded.views_json,active_view_id=excluded.active_view_id WHERE databases.folder_path != excluded.folder_path OR databases.updated_at != excluded.updated_at OR databases.schema_json != excluded.schema_json OR databases.views_json != excluded.views_json`,
  ).run(
    meta.id,
    meta.folderPath,
    meta.name,
    JSON.stringify(meta.schema),
    meta.createdAt,
    meta.updatedAt,
    meta.views.find((v) => v.id === meta.activeViewId)?.type ?? "table",
    JSON.stringify(
      Object.fromEntries(meta.views.map((v) => [v.type, v.config])),
    ),
    JSON.stringify(meta.views),
    meta.activeViewId,
  );
}
export async function listDatabases(ws: Workspace): Promise<DatabaseMeta[]> {
  const folders = await find(ws.root),
    sqlitePath = path.join(ws.root, ".maek", "database.sqlite");
  if (
    folders.length === 0 &&
    !(await stat(sqlitePath)
      .then(() => true)
      .catch(() => false))
  )
    return [];
  await mkdir(path.join(ws.root, ".maek"), { recursive: true });
  const db = openDb(ws),
    out: DatabaseMeta[] = [];
  for (const folder of folders) {
    const m = await readManifest(folder);
    if (!m) continue;
    const meta = {
      ...m,
      folderPath: path.relative(ws.root, folder).split(path.sep).join("/"),
    };
    upsertMeta(db, meta);
    out.push(meta);
  }
  const known = new Set(out.map((m) => m.id));
  for (const raw of db.prepare("SELECT * FROM databases").all() as RawDatabase[]) {
    if (known.has(raw.id)) continue;
    let schema: DatabaseColumnSchema[] = [];
    try {
      schema = JSON.parse(raw.schema_json);
    } catch {}
    let views: DatabaseViewDefinition[] = [];
    try {
      views = JSON.parse(raw.views_json ?? "[]");
    } catch {}
    if (!views.length) {
      let legacy: Record<string, unknown> = {};
      try {
        legacy = JSON.parse(raw.view_config_json ?? "{}");
      } catch {}
      if (typeof legacy.type === "string")
        legacy = { [legacy.type]: legacy.config ?? {} };
      const now = raw.created_at ?? Date.now();
      views = (
        ["table", "kanban", "timeline", "calendar"] as DatabaseViewType[]
      ).map((type) => ({
        id: randomUUID(),
        name: viewName[type],
        type,
        config: {
          ...viewConfig(type, schema),
          ...((legacy[type] as object) ?? {}),
        },
        createdAt: now,
        updatedAt: now,
      }));
    }
    const active = views.some((v) => v.id === raw.active_view_id)
      ? raw.active_view_id!
      : (views.find((v) => v.type === raw.view_type)?.id ?? views[0]!.id);
    const meta: DatabaseMeta = {
      version: 1,
      type: "database",
      id: raw.id,
      name: raw.name,
      folderPath: raw.folder_path,
      schema,
      views,
      activeViewId: active,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    };
    const folder = path.join(ws.root, meta.folderPath);
    if (
      !(await stat(folder)
        .then((s) => s.isDirectory())
        .catch(() => false))
    )
      continue;
    // Existing invalid manifests must never be silently replaced by the cache.
    if (
      await stat(path.join(folder, MANIFEST))
        .then(() => true)
        .catch(() => false)
    )
      continue;
    await writeManifest(folder, meta);
    upsertMeta(db, meta);
    out.push(meta);
  }
  return out
    .map(projectMeta)
    .sort((a, b) => a.folderPath.localeCompare(b.folderPath));
}
export async function createDatabase(
  ws: Workspace,
  parent: string,
  name: string,
  type: DatabaseViewType,
) {
  const safe = name.trim().replace(/[\\/:*?"<>|]/g, "-") || "New Database";
  const folder = path.join(ws.root, parent, safe);
  await mkdir(folder, { recursive: false });
  const schema = defaultSchema(type),
    now = Date.now();
  const view: DatabaseViewDefinition = {
    id: randomUUID(),
    name: viewName[type],
    type,
    config: viewConfig(type, schema),
    createdAt: now,
    updatedAt: now,
  };
  const m: DatabaseManifest = {
    version: 1,
    type: "database",
    id: randomUUID(),
    name: safe,
    schema,
    views: (
      ["table", "kanban", "timeline", "calendar"] as DatabaseViewType[]
    ).map((t) =>
      t === type
        ? view
        : {
            id: randomUUID(),
            name: viewName[t],
            type: t,
            config: viewConfig(t, schema),
            createdAt: now,
            updatedAt: now,
          },
    ),
    activeViewId: view.id,
    createdAt: now,
    updatedAt: now,
  };
  await writeManifest(folder, m);
  const meta = {
    ...m,
    folderPath: path.relative(ws.root, folder).split(path.sep).join("/"),
  };
  upsertMeta(openDb(ws), meta);
  return meta;
}
async function migrateRenamedColumns(
  ws: Workspace,
  folderPath: string,
  current: DatabaseManifest,
  next: DatabaseManifest,
) {
  const previousById = new Map(
    current.schema.map((column) => [column.id, column]),
  );
  const renamed = next.schema
    .map((column) => ({
      from: previousById.get(column.id)?.name,
      to: column.name,
    }))
    .filter((item): item is { from: string; to: string } =>
      Boolean(item.from && item.from !== item.to),
    );
  if (!renamed.length) return async () => {};
  const folder = path.join(ws.root, folderPath),
    files = (await readdir(folder, { withFileTypes: true })).filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    );
  const plans = [] as {
    rel: string;
    content: string;
    original: string;
    baseHash: string;
    baseMtimeMs: number;
  }[];
  for (const entry of files) {
    const rel = folderPath ? `${folderPath}/${entry.name}` : entry.name,
      abs = path.join(ws.root, rel),
      buf = await readFile(abs),
      raw = buf.toString("utf8"),
      split = splitFrontmatterFile(raw);
    let frontmatter = split.frontmatterRaw;
    for (const rename of renamed)
      frontmatter = renameYamlField(frontmatter, rename.from, rename.to);
    const content = composeMarkdownFile(
      frontmatter,
      split.body,
      split.lineEnding,
      split.bodySeparator,
    );
    if (content !== raw) {
      const info = await stat(abs);
      plans.push({
        rel,
        content,
        original: raw,
        baseHash: sha256(buf),
        baseMtimeMs: flooredMtime(info.mtimeMs),
      });
    }
  }
  const applied: {plan:typeof plans[number];hash:string;mtimeMs:number}[]=[];
  const rollback=async()=>{
    const failures=[];
    for(const {plan,hash,mtimeMs} of [...applied].reverse()) {
      try {await writeFile({wsId:ws.wsId,path:plan.rel,content:plan.original,baseHash:hash,baseMtimeMs:mtimeMs});}
      catch(error){failures.push(String(error));}
    }
    if(failures.length)throw new Error('Schema rollback encountered external changes: '+failures.join('; '));
  };
  try {
    for(const plan of plans) {
      const result=await writeFile({wsId:ws.wsId,path:plan.rel,content:plan.content,baseHash:plan.baseHash,baseMtimeMs:plan.baseMtimeMs});
      applied.push({plan,...result});
    }
  }catch(error){await rollback();throw error;}
  return rollback;
}
export async function updateManifest(
  ws: Workspace,
  folderPath: string,
  next: DatabaseManifest,
) {
  const folder = path.join(ws.root, folderPath);
  if (!validManifest(next))
    throw Object.assign(new Error("Invalid database manifest"), {
      statusCode: 400,
      code: "invalid_manifest",
    });
  const current = await readManifest(folder);
  if (!current) throw conflict("changed", "Database changed or disappeared");
  if (current.id !== next.id)
    throw conflict("changed", "Database changed or disappeared");
  if (current.updatedAt !== next.updatedAt)
    throw conflict("changed", "Database settings changed in another window");
  const rollback=await migrateRenamedColumns(ws, folderPath, current, next);
  try {
    const latest=await readManifest(folder);
    if(JSON.stringify(latest)!==JSON.stringify(current))throw conflict('changed','Database settings changed during schema update');
    next={...current,...next,updatedAt:Math.max(Date.now(),current.updatedAt+1)};
    await writeManifest(folder,next);
  }catch(error){await rollback();throw error;}
  const meta = { ...next, folderPath };
  upsertMeta(openDb(ws), meta);
  return meta;
}
export async function rows(
  ws: Workspace,
  meta: DatabaseMeta,
): Promise<DatabaseRow[]> {
  const db = openDb(ws),
    folder = path.join(ws.root, meta.folderPath);
  const files = (await readdir(folder, { withFileTypes: true })).filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".md"),
  );
  const existing = db
    .prepare("SELECT * FROM database_rows WHERE database_id=?")
    .all(meta.id) as RawRow[];
  const byName = new Map(existing.map((r) => [r.file_name, r]));
  const keep = new Set<string>();
  const hashes = new Map<string, string>();
  for (const e of files) {
    keep.add(e.name);
    const abs = path.join(folder, e.name),
      s = await stat(abs),
      buf = await readFile(abs),
      raw = buf.toString("utf8"),
      yaml = parseYamlData(splitFrontmatterFile(raw).frontmatterRaw),
      old = byName.get(e.name);
    hashes.set(e.name, sha256(buf));
    if (
      old &&
      old.file_mtime === flooredMtime(s.mtimeMs) &&
      old.yaml_data === JSON.stringify(yaml)
    )
      continue;
    const now = Date.now(),
      id = old?.id ?? randomUUID(),
      order =
        old?.sort_order ??
        Math.max(-1, ...existing.map((r) => r.sort_order)) + keep.size;
    db.prepare(
      `INSERT INTO database_rows(id,database_id,file_name,yaml_data,file_mtime,created_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(database_id,file_name) DO UPDATE SET yaml_data=excluded.yaml_data,file_mtime=excluded.file_mtime,updated_at=excluded.updated_at`,
    ).run(
      id,
      meta.id,
      e.name,
      JSON.stringify(yaml),
      flooredMtime(s.mtimeMs),
      old?.created_at ?? now,
      now,
      order,
    );
  }
  for (const r of existing)
    if (!keep.has(r.file_name))
      db.prepare("DELETE FROM database_rows WHERE id=?").run(r.id);
  return (
    db
      .prepare(
        "SELECT * FROM database_rows WHERE database_id=? ORDER BY sort_order,file_name",
      )
      .all(meta.id) as RawRow[]
  ).map((r) => ({
    id: r.id,
    databaseId: r.database_id,
    fileName: r.file_name,
    path: meta.folderPath ? `${meta.folderPath}/${r.file_name}` : r.file_name,
    yamlData: JSON.parse(r.yaml_data),
    fileMtime: r.file_mtime,
    hash: hashes.get(r.file_name) ?? "",
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
export async function updateCell(
  ws: Workspace,
  meta: DatabaseMeta,
  rowId: string,
  key: string,
  value: unknown,
) {
  validateCell(
    meta.schema.find((c) => c.name === key),
    value,
  );
  if (!meta.schema.some((column) => column.name === key))
    throw Object.assign(new Error("Unknown database column"), {
      statusCode: 400,
      code: "unknown_column",
    });
  const db = openDb(ws),
    r = db
      .prepare("SELECT * FROM database_rows WHERE id=? AND database_id=?")
      .get(rowId, meta.id) as RawRow | undefined;
  if (!r)
    throw Object.assign(new Error("Row not found"), {
      statusCode: 404,
      code: "row_not_found",
    });
  const rel = meta.folderPath
      ? `${meta.folderPath}/${r.file_name}`
      : r.file_name,
    abs = path.join(ws.root, rel),
    buf = await readFile(abs),
    raw = buf.toString("utf8"),
    split = splitFrontmatterFile(raw);
  const nextRaw = patchYamlField(split.frontmatterRaw, key, value);
  const data = parseYamlData(nextRaw);
  const content = composeMarkdownFile(
    nextRaw,
    split.body,
    split.lineEnding,
    split.bodySeparator,
  );
  const s = await stat(abs);
  const result = await writeFile({
    wsId: ws.wsId,
    path: rel,
    content,
    baseHash: sha256(buf),
    baseMtimeMs: flooredMtime(s.mtimeMs),
  });
  db.prepare(
    "UPDATE database_rows SET yaml_data=?,file_mtime=?,updated_at=? WHERE id=?",
  ).run(JSON.stringify(data), result.mtimeMs, Date.now(), rowId);
  return result;
}
export async function addRow(
  ws: Workspace,
  meta: DatabaseMeta,
  values: Record<string, unknown> = {},
) {
  const folder = path.join(ws.root, meta.folderPath);
  let n = "Untitled.md",
    i = 2;
  while (
    await stat(path.join(folder, n))
      .then(() => true)
      .catch(() => false)
  )
    n = `Untitled ${i++}.md`;
  const raw = Object.keys(values).length
    ? composeMarkdownFile(serializeYamlData(values), "", "\n")
    : "";
  await fsWriteFile(path.join(folder, n), raw, { flag: "wx" });
  return rows(ws, meta);
}
export function reorderRows(ws: Workspace, meta: DatabaseMeta, ids: string[]) {
  const db = openDb(ws);
  db.transaction(() =>
    ids.forEach((id, i) =>
      db
        .prepare(
          "UPDATE database_rows SET sort_order=?,updated_at=? WHERE id=? AND database_id=?",
        )
        .run(i, Date.now(), id, meta.id),
    ),
  )();
}
export async function renameRow(
  ws: Workspace,
  meta: DatabaseMeta,
  rowId: string,
  name: string,
) {
  const db = openDb(ws),
    row = db
      .prepare("SELECT * FROM database_rows WHERE id=? AND database_id=?")
      .get(rowId, meta.id) as RawRow | undefined;
  if (!row)
    throw Object.assign(new Error("Row not found"), {
      statusCode: 404,
      code: "row_not_found",
    });
  const safe =
    (name.trim().replace(/[\\/:*?"<>|]/g, "-") || "Untitled").replace(
      /\.md$/i,
      "",
    ) + ".md";
  if (safe === row.file_name) return safe;
  const from = path.join(ws.root, meta.folderPath, row.file_name),
    to = path.join(ws.root, meta.folderPath, safe);
  if (
    await stat(to)
      .then(() => true)
      .catch(() => false)
  )
    throw conflict("changed", "A row with that file name already exists");
  await rename(from, to);
  db.prepare(
    "UPDATE database_rows SET file_name=?,updated_at=? WHERE id=?",
  ).run(safe, Date.now(), rowId);
  return safe;
}

/** Web commands mirror the desktop operations; callers serialize per workspace. */
export async function databaseCommand(ws: Workspace, input: unknown) {
  const { z } = await import("zod");
  const d = z
    .object({
      databaseId: z.string().min(1),
      action: z.enum([
        "sync",
        "add-row",
        "insert-row",
        "delete-row",
        "cell",
        "schema",
        "rename-row",
        "reorder",
        "active-view",
        "create-view",
        "update-view",
        "delete-view",
        "kanban-drop",
        "unregister",
      ]),
      expectedUpdatedAt: z.number().optional(),
      expectedRowHash: z.string().optional(),
      rowId: z.string().optional(),
      referenceRowId: z.string().optional(),
      position: z.enum(["above", "below"]).optional(),
      rowIds: z.array(z.string()).max(100000).optional(),
      key: z.string().optional(),
      value: z.unknown().optional(),
      values: z.record(z.string(), z.unknown()).optional(),
      name: z.string().trim().min(1).max(255).optional(),
      schema: z.array(z.unknown()).optional(),
      viewId: z.string().optional(),
      type: z.enum(["table", "kanban", "calendar", "timeline"]).optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      rowMove: z
        .object({
          rowId: z.string(),
          groupColumnName: z.string(),
          newValue: z.string().nullable(),
        })
        .nullable()
        .optional(),
    })
    .parse(input);
  let meta = (await listDatabases(ws)).find((m) => m.id === d.databaseId);
  if (!meta)
    throw Object.assign(new Error("Database not found"), { statusCode: 404 });
  const { workspaceTarget } = await import("./workspace/filesystem");
  await workspaceTarget(ws, meta.folderPath);
  let currentRows = await rows(ws, meta);
  const requireRow = (id: string | undefined) => {
    const row = currentRows.find((r) => r.id === id);
    if (!row)
      throw Object.assign(new Error("Row not found"), { statusCode: 404 });
    return row;
  };
  const changesMeta = [
    "schema",
    "active-view",
    "create-view",
    "update-view",
    "delete-view",
  ].includes(d.action);
  if (changesMeta && d.expectedUpdatedAt !== meta.updatedAt)
    throw conflict(
      "changed",
      "Database settings changed in another window. Reload and retry.",
    );
  let changedRowId = d.rowId;
  if (d.expectedRowHash) {
    const row = requireRow(d.rowId ?? d.rowMove?.rowId);
    if (row.hash !== d.expectedRowHash)
      throw conflict(
        "changed",
        "This row changed outside this view. Reload and retry.",
      );
  }
  if (d.action === "unregister") {
    await unlink(path.join(ws.root, meta.folderPath, MANIFEST));
    openDb(ws).prepare("DELETE FROM databases WHERE id=?").run(meta.id);
    return { database: meta, rows: [], row: undefined };
  }
  if (d.action === "add-row" || d.action === "insert-row") {
    if (d.action === "insert-row") requireRow(d.referenceRowId);
    const before = new Set(currentRows.map((r) => r.id));
    const next = await addRow(ws, meta, d.values);
    const added = next.find((r) => !before.has(r.id))!;
    changedRowId = added.id;
    if (d.action === "insert-row") {
      const ids = currentRows.map((r) => r.id),
        index = ids.indexOf(d.referenceRowId!);
      ids.splice(index + (d.position === "below" ? 1 : 0), 0, added.id);
      reorderRows(ws, meta, ids);
    }
  }
  if (d.action === "delete-row") {
    const row = requireRow(d.rowId);
    await workspaceTarget(ws, row.path);
    await unlink(path.join(ws.root, row.path));
  }
  if (d.action === "rename-row") {
    requireRow(d.rowId);
    await renameRow(ws, meta, d.rowId!, z.string().min(1).parse(d.name));
  }
  if (d.action === "cell") {
    requireRow(d.rowId);
    await updateCell(
      ws,
      meta,
      d.rowId!,
      z.string().min(1).parse(d.key),
      d.value,
    );
  }
  if (d.action === "reorder" || d.action === "kanban-drop") {
    const ids = z.array(z.string()).parse(d.rowIds);
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate row ids");
    ids.forEach(requireRow);
    let undo: {path:string;content:string;hash:string;mtimeMs:number}|undefined;
    if (d.action === "kanban-drop" && d.rowMove) {
      const movedRow=requireRow(d.rowMove.rowId);
      const original=await readFile(path.join(ws.root,movedRow.path),'utf8');
      const column = meta.schema.find(
        (c) => c.name === d.rowMove!.groupColumnName && c.type === "select",
      );
      if (!column) throw new Error("Invalid grouping column");
      const saved=await updateCell(
        ws,
        meta,
        d.rowMove.rowId,
        column.name,
        d.rowMove.newValue === null ? undefined : d.rowMove.newValue,
      );
      undo={path:movedRow.path,content:original,...saved};
    }
    const selected = new Set(ids);
    try {reorderRows(ws,meta,[...ids,...currentRows.filter(r=>!selected.has(r.id)).map(r=>r.id)]);}
    catch(error) {
      if(undo)await writeFile({wsId:ws.wsId,path:undo.path,content:undo.content,baseHash:undo.hash,baseMtimeMs:undo.mtimeMs});
      await rows(ws,meta);
      throw error;
    }
  }
  if (changesMeta) {
    let next = { ...meta, views: meta.views.map((v) => ({ ...v })) };
    if (d.action === "schema") next.schema = d.schema as DatabaseColumnSchema[];
    if (d.action === "active-view") {
      if (!next.views.some((v) => v.id === d.viewId))
        throw new Error("View not found");
      next.activeViewId = d.viewId!;
    }
    if (d.action === "create-view") {
      const type = z
          .enum(["table", "kanban", "calendar", "timeline"])
          .parse(d.type),
        now = Date.now();
      const view = {
        id: randomUUID(),
        name: viewName[type],
        type,
        config: viewConfig(type, meta.schema),
        createdAt: now,
        updatedAt: now,
      };
      next.views.push(view);
      next.activeViewId = view.id;
    }
    if (d.action === "update-view") {
      const view = next.views.find((v) => v.id === d.viewId);
      if (!view) throw new Error("View not found");
      if (d.name !== undefined) view.name = d.name;
      if (d.config !== undefined)
        view.config = {...view.config,...d.config} as DatabaseViewDefinition["config"];
      view.updatedAt = Date.now();
    }
    if (d.action === "delete-view") {
      if (next.views.length === 1) throw new Error("Keep at least one view");
      next.views = next.views.filter((v) => v.id !== d.viewId);
      if (next.activeViewId === d.viewId) next.activeViewId = next.views[0]!.id;
    }
    meta = await updateManifest(ws, meta.folderPath, next);
  }
  currentRows = await rows(ws, meta);
  return {
    database: projectMeta(meta),
    rows: currentRows,
    row: currentRows.find((r) => r.id === changedRowId),
  };
}
function projectMeta(meta: DatabaseMeta): DatabaseMeta {
  const view =
    meta.views.find((v) => v.id === meta.activeViewId) ?? meta.views[0]!;
  return {
    ...meta,
    viewType: view.type,
    viewConfig: { type: view.type, config: view.config } as NonNullable<
      DatabaseMeta["viewConfig"]
    >,
  };
}

export async function convertFolder(ws: Workspace, folderPath: string) {
  const { workspaceTarget } = await import("./workspace/filesystem");
  const folder = await workspaceTarget(ws, folderPath);
  if (!(await stat(folder)).isDirectory()) throw new Error("Choose a folder");
  const existing = (await listDatabases(ws)).find(
    (m) => m.folderPath === folderPath,
  );
  if (existing) return existing;
  if (
    await stat(path.join(folder, MANIFEST))
      .then(() => true)
      .catch(() => false)
  )
    throw new Error("An unreadable database manifest already exists");
  const schema = defaultSchema("table"),
    now = Date.now();
  const views = (
    ["table", "kanban", "timeline", "calendar"] as DatabaseViewType[]
  ).map((type) => ({
    id: randomUUID(),
    name: viewName[type],
    type,
    config: viewConfig(type, schema),
    createdAt: now,
    updatedAt: now,
  }));
  const meta: DatabaseMeta = {
    version: 1,
    type: "database",
    id: randomUUID(),
    name: path.basename(folder),
    folderPath,
    schema,
    views,
    activeViewId: views[0]!.id,
    createdAt: now,
    updatedAt: now,
  };
  await writeManifest(folder, meta);
  upsertMeta(openDb(ws), meta);
  return projectMeta(meta);
}
export async function databaseFolderMoved(
  ws: Workspace,
  source: string,
  dest: string,
) {
  for (const meta of await listDatabases(ws)) {
    if (meta.folderPath !== dest && !meta.folderPath.startsWith(dest + "/"))
      continue;
    if (meta.folderPath === dest)
      await updateManifest(ws, dest, {
        ...meta,
        name: path.posix.basename(dest),
      });
  }
  // The manifest scan updates SQLite paths by stable database id.
  void source;
}

function validateCell(
  column: DatabaseColumnSchema | undefined,
  value: unknown,
) {
  if (!column || value === undefined || value === null || value === "") return;
  const date = (v: unknown) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v + "T00:00:00Z"));
  let valid = true;
  switch (column.type) {
    case "number":
      valid = typeof value === "number" && Number.isFinite(value);
      break;
    case "boolean":
      valid = typeof value === "boolean";
      break;
    case "date":
      valid = date(value);
      break;
    case "date-range": {
      const v = value as { start?: unknown; end?: unknown };
      valid =
        typeof value === "object" &&
        !Array.isArray(value) &&
        (v.start == null || date(v.start)) &&
        (v.end == null || date(v.end));
      break;
    }
    case "list":
    case "multi-select":
      valid = Array.isArray(value) && value.every((v) => typeof v === "string");
      break;
    default:
      valid = typeof value === "string";
  }
  if (!valid)
    throw Object.assign(
      new Error("Invalid value for " + column.type + " column " + column.name),
      { statusCode: 400, code: "invalid_cell" },
    );
}
