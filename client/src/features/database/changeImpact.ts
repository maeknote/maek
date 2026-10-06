import type { Change } from "@shared/workspace";
import { isWithinPath } from "@shared/workspace-changes";

const isManifest = (path?: string) => path === ".maek-database.json" || path?.endsWith("/.maek-database.json");

export function affectsDatabaseRegistry(change: Change, databases: { folderPath: string }[]): boolean {
  if (isManifest(change.path) || isManifest(change.source) || change.path === ".maek/database.sqlite") return true;
  if (change.type !== "unlinkDir" && change.type !== "rename") return false;
  return databases.some(database => [change.path, change.source].some(path =>
    path !== undefined && isWithinPath(database.folderPath, path)));
}

export function affectsDatabaseRows(change: Change, folderPath: string): boolean {
  if (change.path === ".maek/database.sqlite") return true;
  const containsRow = (path: string) => {
    const relative = folderPath === "" ? path : path.startsWith(folderPath + "/")
      ? path.slice(folderPath.length + 1) : "";
    return /\.md$/i.test(relative) && !relative.includes("/");
  };
  if ([change.path, change.source].some(path => path !== undefined && containsRow(path))) return true;
  return (change.type.endsWith("Dir") || change.type === "rename")
    && [change.path, change.source].some(path => path !== undefined && isWithinPath(folderPath, path));
}
