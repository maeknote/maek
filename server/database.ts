import Database from "better-sqlite3";
import path from "node:path";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile as fsWriteFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Workspace } from "./workspaces";
import type { DatabaseColumnSchema, DatabaseManifest, DatabaseMeta, DatabaseRow, DatabaseViewDefinition, DatabaseViewType } from "../shared/database";
import { composeMarkdownFile, parseYamlData, patchYamlField, serializeYamlData, splitFrontmatterFile } from "../shared/frontmatter";
import { sha256, flooredMtime } from "./fs/readFile";
import { writeFile } from "./fs/writeFile";
import { conflict } from "./errors";

const MANIFEST = ".maek-database.json";
const dbs = new Map<string, Database.Database>();

function openDb(ws: Workspace) {
  const cached = dbs.get(ws.root); if (cached) return cached;
  const db = new Database(path.join(ws.root, ".maek", "database.sqlite"));
  db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE IF NOT EXISTS databases (id TEXT PRIMARY KEY, folder_path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, schema_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, view_type TEXT NOT NULL DEFAULT 'table', view_config_json TEXT, views_json TEXT, active_view_id TEXT);
    CREATE TABLE IF NOT EXISTS database_rows (id TEXT PRIMARY KEY, database_id TEXT NOT NULL, file_name TEXT NOT NULL, yaml_data TEXT NOT NULL DEFAULT '{}', file_mtime INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(database_id) REFERENCES databases(id) ON DELETE CASCADE);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rows_db_file ON database_rows(database_id,file_name);`);
  const databaseColumns=new Set((db.pragma("table_info(databases)") as {name:string}[]).map(c=>c.name));
  if(!databaseColumns.has("view_type"))db.exec("ALTER TABLE databases ADD COLUMN view_type TEXT NOT NULL DEFAULT 'table'");
  if(!databaseColumns.has("view_config_json"))db.exec("ALTER TABLE databases ADD COLUMN view_config_json TEXT");
  if(!databaseColumns.has("views_json"))db.exec("ALTER TABLE databases ADD COLUMN views_json TEXT");
  if(!databaseColumns.has("active_view_id"))db.exec("ALTER TABLE databases ADD COLUMN active_view_id TEXT");
  const rowColumns=new Set((db.pragma("table_info(database_rows)") as {name:string}[]).map(c=>c.name));
  if(!rowColumns.has("sort_order"))db.exec("ALTER TABLE database_rows ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  dbs.set(ws.root, db); return db;
}
const viewName: Record<DatabaseViewType,string> = { table:"Table", kanban:"Kanban", calendar:"Calendar", timeline:"Timeline" };
function viewConfig(type: DatabaseViewType, schema: DatabaseColumnSchema[]) {
  const state = { sort: [], filter: { combinator: "and" as const, conditions: [] } };
  if (type === "kanban") return { ...state, groupColumnId: schema.find(c=>c.type==="select")?.id ?? null };
  if (type === "calendar") return { ...state, dateColumnId: schema.find(c=>c.type==="date"||c.type==="date-range")?.id ?? null };
  if (type === "timeline") return { ...state, dateColumnId: schema.find(c=>c.type==="date"||c.type==="date-range")?.id ?? null, zoom:"week" as const };
  return state;
}
export function defaultSchema(type: DatabaseViewType): DatabaseColumnSchema[] {
  const text = ():DatabaseColumnSchema => ({id:randomUUID(),name:"Content",type:"text",order:1});
  if(type==="kanban") return [{id:randomUUID(),name:"Status",type:"select",order:0,options:["To Do","In Progress","Done"]},text()];
  if(type==="calendar") return [{id:randomUUID(),name:"Date",type:"date",order:0},text()];
  if(type==="timeline") return [{id:randomUUID(),name:"Period",type:"date-range",order:0},text()];
  return [{...text(),order:0}];
}
function validManifest(v: unknown): v is DatabaseManifest {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const x = v as Record<string, unknown>;
  const nonEmpty = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const columnTypes = new Set([
    "text", "number", "boolean", "date", "date-range", "select", "multi-select", "list",
  ]);
  const viewTypes = new Set(["table", "kanban", "calendar", "timeline"]);
  if (
    x.version !== 1 || x.type !== "database" || !nonEmpty(x.id) ||
    !nonEmpty(x.name) || !nonEmpty(x.activeViewId) ||
    !finite(x.createdAt) || !finite(x.updatedAt) ||
    !Array.isArray(x.schema) || !Array.isArray(x.views) || x.views.length === 0
  ) return false;
  const ids = new Set<string>();
  for (const column of x.schema) {
    if (!column || typeof column !== "object" || Array.isArray(column)) return false;
    const c = column as Record<string, unknown>;
    if (!nonEmpty(c.id) || ids.has(c.id) || !nonEmpty(c.name) ||
      !columnTypes.has(String(c.type)) || !finite(c.order)) return false;
    ids.add(c.id);
    if (c.options !== undefined &&
      (!Array.isArray(c.options) || !c.options.every((option) => typeof option === "string"))) return false;
  }
  const viewIds = new Set<string>();
  for (const view of x.views) {
    if (!view || typeof view !== "object" || Array.isArray(view)) return false;
    const item = view as Record<string, unknown>;
    if (!nonEmpty(item.id) || viewIds.has(item.id) || !nonEmpty(item.name) ||
      !viewTypes.has(String(item.type)) || !item.config ||
      typeof item.config !== "object" || Array.isArray(item.config) ||
      !finite(item.createdAt) || !finite(item.updatedAt)) return false;
    viewIds.add(item.id);
  }
  return viewIds.has(x.activeViewId);
}
async function readManifest(folder:string) { try { const v=JSON.parse(await readFile(path.join(folder,MANIFEST),"utf8")); return validManifest(v)?v:null; } catch { return null; } }
async function writeManifest(folder:string, value:DatabaseManifest) {
  const target=path.join(folder,MANIFEST), tmp=target+`.`+randomUUID()+`.tmp`;
  try { await fsWriteFile(tmp,JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600}); await rename(tmp,target); } finally { await unlink(tmp).catch(()=>{}); }
}
async function find(root:string) {
  const out:string[]=[]; const pending=[root];
  const ignored = new Set([".git", ".maek", ".codex", ".claude", "node_modules", "dist"]);
  while(pending.length){ const dir=pending.pop()!; for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])){ if(e.isFile()&&e.name===MANIFEST) out.push(dir); else if(e.isDirectory()&&!ignored.has(e.name)) pending.push(path.join(dir,e.name)); } }
  return out;
}
function upsertMeta(db:Database.Database, meta:DatabaseMeta){ db.prepare(`INSERT INTO databases(id,folder_path,name,schema_json,created_at,updated_at,view_type,view_config_json,views_json,active_view_id) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET folder_path=excluded.folder_path,name=excluded.name,schema_json=excluded.schema_json,updated_at=excluded.updated_at,view_type=excluded.view_type,view_config_json=excluded.view_config_json,views_json=excluded.views_json,active_view_id=excluded.active_view_id`).run(meta.id,meta.folderPath,meta.name,JSON.stringify(meta.schema),meta.createdAt,meta.updatedAt,meta.views.find(v=>v.id===meta.activeViewId)?.type??"table",JSON.stringify({}),JSON.stringify(meta.views),meta.activeViewId); }
export async function listDatabases(ws:Workspace):Promise<DatabaseMeta[]> {
  const folders=await find(ws.root), sqlitePath=path.join(ws.root,".maek","database.sqlite");
  if(folders.length===0&&!await stat(sqlitePath).then(()=>true).catch(()=>false))return [];
  await mkdir(path.join(ws.root,".maek"),{recursive:true}); const db=openDb(ws), out:DatabaseMeta[]=[];
  for(const folder of folders){ const m=await readManifest(folder); if(!m) continue; const meta={...m,folderPath:path.relative(ws.root,folder).split(path.sep).join("/")}; upsertMeta(db,meta); out.push(meta); }
  const known=new Set(out.map(m=>m.id));
  for(const raw of db.prepare("SELECT * FROM databases").all() as any[]){
    if(known.has(raw.id))continue;
    let schema:DatabaseColumnSchema[]=[];try{schema=JSON.parse(raw.schema_json)}catch{}
    let views:DatabaseViewDefinition[]=[];try{views=JSON.parse(raw.views_json??"[]")}catch{}
    if(!views.length){const type=(raw.view_type??"table") as DatabaseViewType,now=raw.updated_at??Date.now(),id=randomUUID();views=[{id,name:viewName[type]??"Table",type,config:viewConfig(type,schema),createdAt:now,updatedAt:now}];}
    const active=views.some(v=>v.id===raw.active_view_id)?raw.active_view_id:views[0]!.id;
    out.push({version:1,type:"database",id:raw.id,name:raw.name,folderPath:raw.folder_path,schema,views,activeViewId:active,createdAt:raw.created_at,updatedAt:raw.updated_at});
  }
  return out.sort((a,b)=>a.folderPath.localeCompare(b.folderPath));
}
export async function createDatabase(ws:Workspace,parent:string,name:string,type:DatabaseViewType){ const safe=name.trim().replace(/[\\/:*?"<>|]/g,"-")||"New Database"; const folder=path.join(ws.root,parent,safe); await mkdir(folder,{recursive:false}); const schema=defaultSchema(type), now=Date.now(); const view:DatabaseViewDefinition={id:randomUUID(),name:viewName[type],type,config:viewConfig(type,schema),createdAt:now,updatedAt:now}; const m:DatabaseManifest={version:1,type:"database",id:randomUUID(),name:safe,schema,views:[view],activeViewId:view.id,createdAt:now,updatedAt:now}; await writeManifest(folder,m); const meta={...m,folderPath:path.relative(ws.root,folder).split(path.sep).join("/")}; upsertMeta(openDb(ws),meta); return meta; }
export async function updateManifest(ws:Workspace,folderPath:string,next:DatabaseManifest){ const folder=path.join(ws.root,folderPath); if(!validManifest(next)) throw Object.assign(new Error("Invalid database manifest"),{statusCode:400,code:"invalid_manifest"}); const current=await readManifest(folder); if(!current) throw conflict("changed","Database changed or disappeared"); if(current.id!==next.id) throw conflict("changed","Database changed or disappeared"); if(current.updatedAt!==next.updatedAt) throw conflict("changed","Database settings changed in another window"); next={...next,updatedAt:Date.now()}; await writeManifest(folder,next); const meta={...next,folderPath}; upsertMeta(openDb(ws),meta); return meta; }
export async function rows(ws:Workspace,meta:DatabaseMeta):Promise<DatabaseRow[]> { const db=openDb(ws), folder=path.join(ws.root,meta.folderPath); const files=(await readdir(folder,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.toLowerCase().endsWith(".md")); const existing=db.prepare("SELECT * FROM database_rows WHERE database_id=?").all(meta.id) as any[]; const byName=new Map(existing.map(r=>[r.file_name,r])); const keep=new Set<string>(); for(const e of files){ keep.add(e.name); const abs=path.join(folder,e.name), s=await stat(abs), buf=await readFile(abs), raw=buf.toString("utf8"), yaml=parseYamlData(splitFrontmatterFile(raw).frontmatterRaw), old=byName.get(e.name); const now=Date.now(), id=old?.id??randomUUID(), order=old?.sort_order??existing.length; db.prepare(`INSERT INTO database_rows(id,database_id,file_name,yaml_data,file_mtime,created_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(database_id,file_name) DO UPDATE SET yaml_data=excluded.yaml_data,file_mtime=excluded.file_mtime,updated_at=excluded.updated_at`).run(id,meta.id,e.name,JSON.stringify(yaml),flooredMtime(s.mtimeMs),old?.created_at??now,now,order); }
  for(const r of existing) if(!keep.has(r.file_name)) db.prepare("DELETE FROM database_rows WHERE id=?").run(r.id);
  return (db.prepare("SELECT * FROM database_rows WHERE database_id=? ORDER BY sort_order,file_name").all(meta.id) as any[]).map(r=>({id:r.id,databaseId:r.database_id,fileName:r.file_name,path:meta.folderPath?`${meta.folderPath}/${r.file_name}`:r.file_name,yamlData:JSON.parse(r.yaml_data),fileMtime:r.file_mtime,hash:"",sortOrder:r.sort_order,createdAt:r.created_at,updatedAt:r.updated_at})); }
export async function updateCell(ws:Workspace,meta:DatabaseMeta,rowId:string,key:string,value:unknown){ const db=openDb(ws), r=db.prepare("SELECT * FROM database_rows WHERE id=? AND database_id=?").get(rowId,meta.id) as any; if(!r) throw new Error("Row not found"); const rel=meta.folderPath?`${meta.folderPath}/${r.file_name}`:r.file_name, abs=path.join(ws.root,rel), buf=await readFile(abs), raw=buf.toString("utf8"), split=splitFrontmatterFile(raw); const nextRaw=patchYamlField(split.frontmatterRaw,key,value); const data=parseYamlData(nextRaw); const content=composeMarkdownFile(nextRaw,split.body,split.lineEnding,split.bodySeparator); const s=await stat(abs); const result=await writeFile({wsId:ws.wsId,path:rel,content,baseHash:sha256(buf),baseMtimeMs:flooredMtime(s.mtimeMs)}); db.prepare("UPDATE database_rows SET yaml_data=?,file_mtime=?,updated_at=? WHERE id=?").run(JSON.stringify(data),result.mtimeMs,Date.now(),rowId); return result; }
export async function addRow(ws:Workspace,meta:DatabaseMeta,values:Record<string,unknown>={}) { const folder=path.join(ws.root,meta.folderPath); let n="Untitled.md",i=2; while(await stat(path.join(folder,n)).then(()=>true).catch(()=>false)) n=`Untitled ${i++}.md`; const raw=Object.keys(values).length?composeMarkdownFile(serializeYamlData(values),"","\n"):""; await fsWriteFile(path.join(folder,n),raw,{flag:"wx"}); return rows(ws,meta); }
export function reorderRows(ws:Workspace,meta:DatabaseMeta,ids:string[]){ const db=openDb(ws); db.transaction(()=>ids.forEach((id,i)=>db.prepare("UPDATE database_rows SET sort_order=?,updated_at=? WHERE id=? AND database_id=?").run(i,Date.now(),id,meta.id)))(); }
export async function renameRow(ws:Workspace,meta:DatabaseMeta,rowId:string,name:string){const db=openDb(ws),row=db.prepare("SELECT * FROM database_rows WHERE id=? AND database_id=?").get(rowId,meta.id) as any;if(!row)throw new Error("Row not found");const safe=(name.trim().replace(/[\\/:*?"<>|]/g,"-")||"Untitled").replace(/\.md$/i,"")+".md";const from=path.join(ws.root,meta.folderPath,row.file_name),to=path.join(ws.root,meta.folderPath,safe);await rename(from,to);db.prepare("UPDATE database_rows SET file_name=?,updated_at=? WHERE id=?").run(safe,Date.now(),rowId);return safe;}
