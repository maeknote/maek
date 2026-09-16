import path from "node:path";
import { kindFor } from "./file-kind";

/**
 * The workspace-root `.maek/tabs.json` is the original desktop app's
 * "version 4" document and the shared source of truth for the open-tab list
 * and order. The web app only manages the subset of tabs it can display —
 * file-backed tabs whose path lives inside the workspace. Everything else
 * (desktop-only DB/meeting/settings tabs, unknown fields, `tabGroups`,
 * `editorSplit`) is preserved verbatim so re-opening the desktop app restores
 * its own layout.
 */

/** viewKinds the web app cannot render and therefore never manages. */
const DESKTOP_ONLY_VIEW_KINDS = new Set([
  "database",
  "meeting",
  "workspace-settings",
]);

interface RootTabEntry {
  id?: unknown;
  viewKind?: unknown;
  [key: string]: unknown;
}

export interface RootTabsDocument {
  version?: unknown;
  tabs?: unknown;
  activeTabId?: unknown;
  [key: string]: unknown;
}

const toRelative = (root: string, p: string) =>
  path.isAbsolute(p) ? path.relative(root, p) : p;

/**
 * A tab entry is web-managed when it is a file tab the web app can display and
 * its path resolves inside the workspace. Desktop-only view kinds and paths
 * that escape the workspace are treated as preserved (hidden) entries.
 */
function isWebManaged(
  root: string,
  entry: RootTabEntry,
  virtual = false,
): boolean {
  if (typeof entry.id !== "string") return false;
  if (DESKTOP_ONLY_VIEW_KINDS.has(String(entry.viewKind ?? ""))) {
    if (
      !virtual ||
      !["database", "workspace-settings"].includes(String(entry.viewKind))
    )
      return false;
    if (
      entry.viewKind === "workspace-settings" &&
      toRelative(root, entry.id) !== ".maek"
    )
      return false;
  }
  const relative = toRelative(root, entry.id);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  return true;
}

const webViewKind = (relativePath: string) =>
  kindFor(relativePath) === "editor"
    ? "editor"
    : kindFor(relativePath) === "sheet"
      ? "spreadsheet"
      : kindFor(relativePath) === "unsupported"
        ? "unsupported"
        : "preview";

/**
 * Extract the ordered list of web-managed tab paths (workspace-relative) and
 * the document's active tab, if it is itself web-managed.
 */
export function readRootTabs(
  root: string,
  document: RootTabsDocument,
  virtual = false,
): { tabs: string[]; activeTabId: string | null } {
  const entries = Array.isArray(document.tabs)
    ? (document.tabs as RootTabEntry[])
    : [];
  const tabs = entries
    .filter((entry) => isWebManaged(root, entry, virtual))
    .map((entry) => tabKey(root, entry));
  const activeEntry = entries.find((e) => e.id === document.activeTabId);
  const active = activeEntry ? tabKey(root, activeEntry) : null;
  const activeTabId =
    active && !active.startsWith("..") && tabs.includes(active) ? active : null;
  return { tabs, activeTabId };
}

/**
 * Produce a new root document that keeps every preserved (desktop-only) tab and
 * unknown field from `existing`, and replaces the web-managed tabs with
 * `webTabs` in the given order. Preserved entries keep their relative order and
 * are placed ahead of the web-managed tabs.
 */
export function mergeRootTabs(
  root: string,
  existing: RootTabsDocument | null,
  webTabs: string[],
  activeTabId: string | null,
  virtual = false,
): RootTabsDocument {
  const base: RootTabsDocument =
    existing && typeof existing === "object" ? { ...existing } : {};
  const existingEntries = Array.isArray(base.tabs)
    ? (base.tabs as RootTabEntry[])
    : [];
  const preserved = existingEntries.filter(
    (entry) => !isWebManaged(root, entry, virtual),
  );
  // Reuse the previous entry object for a web tab when its path is unchanged so
  // we do not drop original per-tab metadata (scroll, pinned, etc.).
  const previousById = new Map<string, RootTabEntry>();
  for (const entry of existingEntries) {
    if (isWebManaged(root, entry, virtual))
      previousById.set(tabKey(root, entry), entry);
  }
  const webEntries = webTabs.map((relative) => {
    const previous = previousById.get(relative);
    if (virtual && relative === "maek:virtual:dashboard")
      return {
        ...previous,
        id: path.join(root, ".maek"),
        name: ".maek",
        viewKind: "workspace-settings",
        isEphemeral: false,
      };
    if (virtual && relative.startsWith("maek:virtual:database:")) {
      const folder = relative.slice("maek:virtual:database:".length);
      return {
        ...previous,
        id: path.join(root, folder),
        name: path.basename(folder),
        viewKind: "database",
        isEphemeral: false,
      };
    }
    return {
      ...(previous ?? {}),
      id: path.join(root, relative),
      name: path.basename(relative),
      parentName: path.basename(path.dirname(relative)),
      isEphemeral: false,
      viewKind: webViewKind(relative),
    } satisfies RootTabEntry;
  });
  const activeInWeb =
    activeTabId && webTabs.includes(activeTabId)
      ? (webEntries[webTabs.indexOf(activeTabId)]?.id as string)
      : null;
  return {
    ...base,
    version: 4,
    tabs: [...preserved, ...webEntries],
    activeTabId: activeInWeb ?? base.activeTabId ?? null,
  };
}

function tabKey(root: string, entry: RootTabEntry) {
  const relative = toRelative(root, entry.id as string);
  if (entry.viewKind === "database") return "maek:virtual:database:" + relative;
  if (entry.viewKind === "workspace-settings") return "maek:virtual:dashboard";
  return relative;
}
