import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import type { Workspace } from "../workspaces";
import { WorkspaceMetadataRepository } from "./repository";
import type {
  DashboardState,
  RecentFilesData,
  MaekWorkspaceConfig,
  FolderAppearanceData,
} from "../../shared/workspace-settings";
import { conflict } from "../core/errors";
const repository = new WorkspaceMetadataRepository();
async function read<T>(
  ws: Workspace,
  name: string,
  fallback: T,
): Promise<{ value: T; raw: string | null; error: string | null }> {
  try {
    const raw = await readFile(await repository.path(ws, name), "utf8");
    return { value: JSON.parse(raw) as T, raw, error: null };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { value: fallback, raw: null, error: null };
    return { value: fallback, raw: null, error: String(e) };
  }
}
export async function readRecents(ws: Workspace): Promise<RecentFilesData> {
  const stored = await read<RecentFilesData>(ws, "recentFiles.json", {
    version: 1,
    entries: {},
  });
  if (stored.error) throw new Error(stored.error);
  const result = stored.value;
  if (
    result.version !== 1 ||
    !result.entries ||
    typeof result.entries !== "object"
  )
    throw new Error("Invalid recent files document");
  const marker = await read(ws, "migrations/shared-recents-v1.json", null);
  if (!marker.raw) {
    const sessions = await repository.path(ws, "sessions/web");
    for (const entry of await readdir(sessions, { withFileTypes: true }).catch(
      () => [],
    )) {
      if (!entry.isDirectory()) continue;
      const legacy = await read<
        | RecentFilesData
        | { path: string; lastOpened: number; openCount?: number }[]
      >(ws, `sessions/web/${entry.name}/recentFiles.json`, {
        version: 1,
        entries: {},
      });
      const entries = Array.isArray(legacy.value)
        ? Object.fromEntries(
            legacy.value.map((f) => [
              path.resolve(ws.root, f.path),
              { lastOpenedAt: f.lastOpened, openCount: f.openCount ?? 1 },
            ]),
          )
        : legacy.value.entries;
      for (const [key, value] of Object.entries(entries ?? {})) {
        const absolute = path.resolve(ws.root, key),
          relative = path.relative(ws.root, absolute);
        if (relative.startsWith("..") || !Number.isFinite(value.lastOpenedAt))
          continue;
        const old = result.entries[absolute];
        result.entries[absolute] = {
          lastOpenedAt: Math.max(old?.lastOpenedAt ?? 0, value.lastOpenedAt),
          openCount: Math.max(old?.openCount ?? 0, value.openCount ?? 1),
        };
      }
    }
    await repository.writeJson(ws, "recentFiles.json", result);
    await repository.writeJson(ws, "migrations/shared-recents-v1.json", {
      version: 1,
    });
  }
  return result;
}
export function recentList(ws: Workspace, data: RecentFilesData) {
  return Object.entries(data.entries)
    .map(([p, v]) => ({
      path: path.relative(ws.root, path.resolve(ws.root, p)),
      lastOpened: v.lastOpenedAt,
      openCount: v.openCount,
    }))
    .filter((f) => !f.path.startsWith(".."))
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .slice(0, 200);
}
export async function mutateRecents(
  ws: Workspace,
  action: "open" | "remove" | "clear",
  relative?: string,
) {
  const data = await readRecents(ws);
  const absolute =
    relative === undefined ? undefined : path.resolve(ws.root, relative);
  if (action === "clear") data.entries = {};
  if (action === "remove" && absolute) delete data.entries[absolute];
  if (action === "open" && absolute)
    data.entries[absolute] = {
      lastOpenedAt: Date.now(),
      openCount: (data.entries[absolute]?.openCount ?? 0) + 1,
    };
  await repository.writeJson(ws, "recentFiles.json", data);
  return recentList(ws, data);
}
export async function dashboard(ws: Workspace): Promise<DashboardState> {
  const config = await read<MaekWorkspaceConfig>(ws, "config.json", {
    version: 1,
    name: ws.name,
    createdAt: Date.now(),
  });
  const tabs = await read<DashboardState["tabs"]>(ws, "tabs.json", null);
  if (
    !config.value ||
    typeof config.value !== "object" ||
    !Number.isFinite(config.value.createdAt)
  ) {
    config.error = "Invalid workspace metadata";
    config.value = { version: 1, name: ws.name, createdAt: Date.now() };
  }
  if (
    tabs.value &&
    (!Array.isArray(tabs.value.tabs) ||
      (tabs.value.tabGroups !== undefined &&
        !Array.isArray(tabs.value.tabGroups)))
  ) {
    tabs.error = "Invalid saved tab session";
    tabs.value = null;
  }
  const appearance = await read<FolderAppearanceData>(
    ws,
    "folder-appearance.json",
    { version: 1, folders: {} },
  );
  if (
    !appearance.value ||
    typeof appearance.value.folders !== "object" ||
    !appearance.value.folders
  ) {
    appearance.error = "Invalid folder appearance document";
    appearance.value = { version: 1, folders: {} };
  }
  let recents: RecentFilesData = { version: 1, entries: {} },
    recentsError: string | null = null;
  try {
    recents = await readRecents(ws);
  } catch (e) {
    recentsError = String(e);
  }
  return {
    config: config.value,
    rawConfig: config.raw,
    configExists: !!config.raw,
    configError: config.error,
    tabs: tabs.value,
    tabsError: tabs.error,
    recents,
    recentsError,
    folderAppearance: appearance.value,
    folderAppearanceError: appearance.error,
  };
}
export async function saveConfig(
  ws: Workspace,
  description: string,
  rawConfig: string | null,
) {
  const current = await read<MaekWorkspaceConfig>(ws, "config.json", {
    version: 1,
    name: ws.name,
    createdAt: Date.now(),
  });
  if (current.error) throw new Error(current.error);
  if (current.raw !== rawConfig)
    throw conflict(
      "changed",
      "Workspace settings changed. Reload before saving.",
    );
  await repository.writeJson(ws, "config.json", {
    ...current.value,
    name: ws.name,
    description,
  });
  return dashboard(ws);
}
export async function resetWorkspaceState(
  ws: Workspace,
  action: "tabs" | "appearance",
) {
  await repository.writeJson(
    ws,
    action === "tabs" ? "tabs.json" : "folder-appearance.json",
    action === "tabs"
      ? {
          version: 4,
          activeTabId: null,
          tabs: [],
          tabGroups: [],
          editorSplit: {
            layout: "single",
            activePaneId: "main",
            panes: [{ id: "main", activeTabId: null, tabIds: [] }],
          },
        }
      : { version: 1, folders: {} },
  );
  return dashboard(ws);
}
