import { readFile } from "node:fs/promises";
import type { Workspace } from "../workspaces";
import { WorkspaceMetadataRepository } from "./repository";
import type { FolderAppearanceData } from "../../shared/workspace-settings";

const repository = new WorkspaceMetadataRepository();

const APPEARANCE_FILE = "folder-appearance.json";

type FolderMap = FolderAppearanceData["folders"];

/**
 * Remap folder-appearance keys after a folder is moved or renamed.
 *
 * Every key equal to `source` or beginning with `source + "/"` is rewritten so
 * its prefix becomes `dest` (preserving the descendant suffix). All unaffected
 * entries are kept untouched. When a remapped key collides with a stale entry
 * already sitting at the destination, the moved folder's appearance wins.
 *
 * Returns `null` when nothing matched, so callers can skip rewriting the file.
 */
export function remapFolderAppearancePaths(
  folders: FolderMap,
  source: string,
  dest: string,
): FolderMap | null {
  if (source === dest) return null;

  const isAffected = (key: string) =>
    key === source || key.startsWith(source + "/");

  const affectedKeys = Object.keys(folders).filter(isAffected);
  if (affectedKeys.length === 0) return null;

  const remapKey = (key: string) =>
    key === source ? dest : dest + key.slice(source.length);

  const remappedTargets = new Set(affectedKeys.map(remapKey));

  const next: FolderMap = {};
  // 1. Preserve every entry that is neither moved nor overwritten by a move.
  for (const [key, value] of Object.entries(folders)) {
    if (isAffected(key)) continue;
    // A stale entry that a moved folder now overwrites is dropped: the moved
    // folder's appearance wins the collision.
    if (remappedTargets.has(key)) continue;
    next[key] = value;
  }
  // 2. Write the moved entries at their new keys.
  for (const key of affectedKeys) {
    next[remapKey(key)] = folders[key]!;
  }
  return next;
}

async function readAppearance(ws: Workspace): Promise<FolderAppearanceData> {
  try {
    const raw = await readFile(await repository.path(ws, APPEARANCE_FILE), "utf8");
    const parsed = JSON.parse(raw) as FolderAppearanceData;
    if (!parsed || typeof parsed.folders !== "object" || !parsed.folders)
      return { version: 1, folders: {} };
    return { version: 1, folders: parsed.folders };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, folders: {} };
    throw error;
  }
}

/**
 * Read `.maek/folder-appearance.json`, remap the paths for a move from `source`
 * to `dest`, and atomically rewrite the file when at least one entry changed.
 * A no-op (no matching entries) leaves the file untouched. Callers must invoke
 * this inside the workspace serialization block so it cannot interleave with an
 * appearance PUT.
 *
 * Returns `true` when the file was rewritten, `false` otherwise.
 */
export async function moveFolderAppearance(
  ws: Workspace,
  source: string,
  dest: string,
): Promise<boolean> {
  const current = await readAppearance(ws);
  const remapped = remapFolderAppearancePaths(current.folders, source, dest);
  if (!remapped) return false;
  await repository.writeJson(ws, APPEARANCE_FILE, {
    version: 1,
    folders: remapped,
  });
  return true;
}
