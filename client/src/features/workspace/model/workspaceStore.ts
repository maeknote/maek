import { create } from "zustand";
import type { WorkspaceRef } from "@shared/contract";
import type {
  FileNode,
  FileContent,
  Change,
  RootTabs,
  UiState,
  ViewGroup,
} from "@shared/workspace";
import type { TabItem, FrontmatterViewMode } from "@renderer/features/editor";
import {
  splitFrontmatter,
  isTabDirty,
  getTabFileContent,
  validateFrontmatterYaml,
} from "@renderer/features/editor";
import { api, ApiError, setHostWorkspace } from "@renderer/shared/api";
import { queryClient } from "@renderer/app/query-client";
import { resolveTheme, systemPrefersDark } from "@renderer/lib/preferences";
import { removeWorkspaceFromList } from "@renderer/lib/workspaceList";

export interface Tab extends TabItem {
  file: FileContent;
  initialContent: string;
  status: "idle" | "saving" | "saved" | "conflict" | "error";
  error?: string;
  generation: number;
}
export type { ViewGroup } from "@shared/workspace";
interface State {
  workspaces: { id: string; name: string; path: string }[];
  workspace: WorkspaceRef | null;
  nodes: FileNode[];
  tabs: Tab[];
  activeTabId: string | null;
  /** Browser-local workspaces shown as the rows in Open Tabs. */
  viewGroups: ViewGroup[];
  activeViewGroupId: string | null;
  error: string;
  connectionError: string;
  ready: boolean;
  restoring: boolean;
  openingPhase: "idle" | "selecting" | "opening" | "indexing" | "restoring-tabs";
  openingWorkspace: WorkspaceRef | null;
  connectionStatus: "closed" | "opening" | "ready" | "reconnecting" | "failed";
  scrollPositions: Record<string, number>;
  expanded: string[];
  theme: "system" | "light" | "dark";
  sidebarWidth: number;
  split: { left: string | null; right: string | null; active: "left" | "right"; ratio: number };
  recentFiles: { path: string; lastOpened: number; openCount?: number }[];
  openWorkspace: (path?: string) => Promise<void>;
  /** Removes a workspace from this browser's recent list only. Does not touch
   *  the folder or its `.maek` files. */
  removeWorkspace: (path: string) => void;
  cancelWorkspaceOpen: () => void;
  reconnectWorkspace: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Opens a file permanently, unless explicitly requested as a preview. */
  openFile: (
    id: string,
    options?: { preview?: boolean; source?: "route" },
  ) => Promise<void>;
  openFileToSide: (id: string) => Promise<void>;
  setSplitActive: (pane: "left" | "right") => void;
  setSplitRatio: (ratio: number) => void;
  singlePane: (pane: "left" | "right") => void;
  openDashboard: () => void;
  openKanban: (folderPath: string) => void;
  openDatabase: (folderPath: string, name?: string) => void;
  clearRecentFiles: () => void;
  save: (id: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  closeTab: (id: string) => Promise<void>;
  closeViewGroup: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  setActiveViewGroup: (id: string) => void;
  reorderTabs: (fromIndex: number, insertionIndex: number) => void;
  reorderViewGroups: (fromIndex: number, insertionIndex: number) => void;
  syncTabsFromRoot: () => Promise<void>;
  updateBody: (id: string, body: string, options?: { pin?: boolean }) => void;
  rebase: (id: string, body: string) => void;
  reload: (id: string) => Promise<void>;
  /** User-initiated preview refresh (e.g. HTML artifact reload). Bumps the
   *  per-tab previewNonce so only this tab's iframe is recreated. */
  refreshPreview: (id: string) => void;
  change: (event: Change) => Promise<void>;
  move: (source: string, dest: string) => Promise<void>;
  /** Remap in-memory tab/scroll/expanded/recent state for a move that has
   *  already been persisted to disk. Does not save or refresh. */
  applyMoveToState: (source: string, dest: string) => void;
  updateFrontmatterRaw: (id: string, raw: string) => void;
  toggleFrontmatterExpanded: (id: string) => void;
  setFrontmatterViewMode: (id: string, mode: FrontmatterViewMode) => void;
  persist: () => Promise<void>;
  setError: (message: string) => void;
}
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saves = new Map<string, Promise<boolean>>();
let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let events: EventSource | null = null;
let sessionEpoch = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
let workspaceOpenEpoch = 0;
let workspaceOpenController: AbortController | undefined;
type SplitPane = State["split"]["active"];
// File reads can finish out of order. Keep pane placement and focus intent
// separate so a stale response may add its tab without stealing the latest
// user selection.
let tabFocusIntent = 0;
const paneOpenIntent: Record<SplitPane, number> = { left: 0, right: 0 };

function invalidateTabFocus() {
  tabFocusIntent++;
}

function invalidatePaneOpen(pane: SplitPane) {
  invalidateTabFocus();
  paneOpenIntent[pane]++;
}

/**
 * Whether this browser changed the open-tab list (open/close/reorder) since the
 * last persist. Only a tab-list change rewrites the shared root `.maek/tabs.json`
 * — UI-only autosaves (scroll, theme, sidebar) never touch it, so an idle
 * browser cannot clobber an external edit and the watcher does not feed back.
 */
let tabsDirty = false;
export function markTabsDirty() {
  tabsDirty = true;
}
function later() {
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => void useStore.getState().persist(), 300);
}
function storedWorkspaces(): State["workspaces"] {
  try {
    const value = JSON.parse(
      localStorage.getItem("maek:workspaces") ??
        localStorage.getItem("oh-my-maek:workspaces") ??
        "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is State["workspaces"][number] =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.path === "string",
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}
const patchTab = (id: string, fn: (t: Tab) => Tab) =>
  useStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)),
  }));
function connectEvents(
  ws: WorkspaceRef,
  set: (partial: Partial<State>) => void,
  get: () => State,
) {
  events?.close();
  clearTimeout(reconnectTimer);
  events = new EventSource(
    "/api/workspaces/events?workspace=" + encodeURIComponent(ws.wsId),
  );
  events.addEventListener(
    "change",
    (event) =>
      void get().change(JSON.parse((event as MessageEvent).data) as Change),
  );
  events.addEventListener("rescan", () => void get().refresh());
  events.addEventListener(
    "tabs-session-changed",
    () => void get().syncTabsFromRoot(),
  );
  events.addEventListener("watch-error", () => {
    set({
      connectionStatus: "failed",
      connectionError: "File watching stopped. Reconnecting…",
    });
    events?.close();
    reconnectTimer = setTimeout(() => void get().reconnectWorkspace(), 500);
  });
  events.onerror = () => {
    events?.close();
    set({
      connectionStatus: "reconnecting",
      connectionError: "Connection interrupted. Reconnecting…",
    });
    const delay = Math.min(500 * 2 ** reconnectAttempt++, 5000);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => void get().reconnectWorkspace(), delay);
  };
  events.onopen = () => {
    reconnectAttempt = 0;
    set({ connectionStatus: "ready", connectionError: "" });
  };
}
/**
 * Virtual tabs (dashboard, kanban) are not backed by a file on disk. They live
 * only in client memory and are excluded from persistence — the session schema
 * stores real file paths only. Their ids are namespaced so they never collide
 * with a workspace-relative file path.
 */
export const DASHBOARD_TAB_ID = "maek:virtual:dashboard";
export const kanbanTabId = (folderPath: string) =>
  `maek:virtual:kanban:${folderPath}`;
export const databaseTabId = (folderPath: string) =>
  `maek:virtual:database:${folderPath}`;
function restoreVirtualTab(id:string):Tab|null {
  if(id===DASHBOARD_TAB_ID)return makeVirtualTab(id,'Home','workspace-settings');
  if(id.startsWith('maek:virtual:database:')) {
    const folder=id.slice('maek:virtual:database:'.length);
    return makeVirtualTab(id,folder.split('/').pop()??'Database','database',folder);
  }
  return null;
}
function isSharedTab(tab:Tab) {return !tab.isPopup && !tab.isEphemeral && tab.viewKind!=='kanban';}
export function isVirtualTabId(id: string): boolean {
  return id.startsWith("maek:virtual:");
}

let viewGroupSequence = 0;
function newViewGroupId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `view:${uuid}` : `view:${Date.now()}:${++viewGroupSequence}`;
}
function singleViewGroup(tabId: string): ViewGroup {
  return { id: newViewGroupId(), kind: "single", tabId };
}
function groupTabIds(group: ViewGroup): string[] {
  return group.kind === "single" ? [group.tabId] : [group.left, group.right];
}
function groupActiveTabId(group: ViewGroup): string {
  return group.kind === "single"
    ? group.tabId
    : group.active === "left"
      ? group.left
      : group.right;
}
function groupSplit(group: ViewGroup): State["split"] {
  return group.kind === "single"
    ? { left: group.tabId, right: null, active: "left", ratio: 0.5 }
    : { left: group.left, right: group.right, active: group.active, ratio: group.ratio };
}
function groupsFromUi(tabs: Tab[], ui: UiState): ViewGroup[] {
  const available = new Set(tabs.map((tab) => tab.id));
  const claimed = new Set<string>();
  const groups: ViewGroup[] = [];
  for (const group of ui.viewGroups ?? []) {
    if (group.kind === "single") {
      if (!available.has(group.tabId) || claimed.has(group.tabId)) continue;
      groups.push(group);
      claimed.add(group.tabId);
      continue;
    }
    const left = available.has(group.left) && !claimed.has(group.left) ? group.left : null;
    const right = available.has(group.right) && !claimed.has(group.right) ? group.right : null;
    if (left && right) {
      groups.push({ ...group, left, right });
      claimed.add(left);
      claimed.add(right);
    } else if (left || right) {
      const tabId = left ?? right!;
      groups.push({ id: group.id, kind: "single", tabId });
      claimed.add(tabId);
    }
  }
  // v1 migration: retain the current split as one group when no v2 layout was
  // stored. The remaining files become single groups in their current order.
  if (!groups.length && ui.split?.left && ui.split?.right &&
      available.has(ui.split.left) && available.has(ui.split.right) &&
      ui.split.left !== ui.split.right) {
    groups.push({
      id: newViewGroupId(), kind: "split", left: ui.split.left, right: ui.split.right,
      active: ui.split.active, ratio: ui.split.ratio,
    });
    claimed.add(ui.split.left);
    claimed.add(ui.split.right);
  }
  for (const tab of tabs) {
    if (!claimed.has(tab.id)) groups.push(singleViewGroup(tab.id));
  }
  return groups;
}
function reconcileViewGroups(groups: ViewGroup[], tabs: Tab[]): ViewGroup[] {
  const ui: UiState = {
    activeTabId: null, scrollPositions: {}, expanded: [], theme: "system", sidebarWidth: 300,
    viewGroups: groups,
  };
  return groupsFromUi(tabs, ui);
}
function remapViewGroups(groups: ViewGroup[], replace: (id: string) => string): ViewGroup[] {
  return groups.map((group) => group.kind === "single"
    ? { ...group, tabId: replace(group.tabId) }
    : { ...group, left: replace(group.left), right: replace(group.right) });
}

const VIRTUAL_FILE: FileContent = {
  content: "",
  kind: "unsupported",
  hash: "",
  mtimeMs: 0,
  size: 0,
};

function makeVirtualTab(
  id: string,
  name: string,
  viewKind: "workspace-settings" | "kanban" | "database",
  kanbanFolderPath?: string,
): Tab {
  return {
    id,
    name,
    parentName: "",
    bodyContent: "",
    savedBodyContent: "",
    frontmatter: {
      hasFrontmatter: false,
      raw: null,
      savedRaw: null,
      expanded: false,
      validationError: null,
      lineEnding: "\n",
      viewMode: "properties",
    },
    diskNormalizedBody: "",
    diskFileContent: "",
    viewKind,
    previewFormat: null,
    previewNonce: 0,
    isEphemeral: false,
    kanbanFolderPath,
    databaseFolderPath: viewKind === "database" ? kanbanFolderPath : undefined,
    file: VIRTUAL_FILE,
    initialContent: "",
    status: "idle",
    generation: 0,
  };
}

function remapWorkspacePath(path: string, source: string, dest: string): string {
  if (path === source) return dest;
  return path.startsWith(source + "/") ? dest + path.slice(source.length) : path;
}

/** Keep virtual tab identities and labels separate from file-path remapping. */
function remapTabForRename(tab: Tab, source: string, dest: string): Tab {
  if (tab.viewKind === "workspace-settings") return tab;

  if (tab.viewKind === "database") {
    const folderPath = remapWorkspacePath(
      tab.databaseFolderPath ?? tab.id.slice("maek:virtual:database:".length),
      source,
      dest,
    );
    return {
      ...tab,
      id: databaseTabId(folderPath),
      databaseFolderPath: folderPath,
      name: folderPath.split("/").pop() ?? "Database",
      parentName: "",
    };
  }

  if (tab.viewKind === "kanban") {
    const folderPath = remapWorkspacePath(
      tab.kanbanFolderPath ?? tab.id.slice("maek:virtual:kanban:".length),
      source,
      dest,
    );
    const name = folderPath ? (folderPath.split("/").pop() ?? "") : "Workspace";
    return {
      ...tab,
      id: kanbanTabId(folderPath),
      kanbanFolderPath: folderPath,
      name: `${name} Kanban`,
      parentName: "",
    };
  }

  const id = remapWorkspacePath(tab.id, source, dest);
  return {
    ...tab,
    id,
    name: id.split("/").pop()!,
    parentName: id.split("/").slice(-2, -1).join(""),
  };
}

function remapTabIdForRename(id: string, source: string, dest: string): string {
  if (id === DASHBOARD_TAB_ID) return id;
  if (id.startsWith("maek:virtual:database:"))
    return databaseTabId(
      remapWorkspacePath(id.slice("maek:virtual:database:".length), source, dest),
    );
  if (id.startsWith("maek:virtual:kanban:"))
    return kanbanTabId(
      remapWorkspacePath(id.slice("maek:virtual:kanban:".length), source, dest),
    );
  return remapWorkspacePath(id, source, dest);
}

export function makeTab(id: string, file: FileContent): Tab {
  if (file.kind === "sheet") {
    const content = file.content ?? "";
    const frontmatter = splitFrontmatter("").frontmatter;
    return {
      id,
      name: id.split("/").pop()!,
      parentName: id.split("/").slice(-2, -1).join(""),
      bodyContent: content,
      savedBodyContent: content,
      frontmatter,
      diskNormalizedBody: content,
      diskFileContent: content,
      initialContent: content,
      viewKind: "spreadsheet",
      previewFormat: null,
      previewNonce: 0,
      isEphemeral: false,
      file,
      status: "idle",
      generation: 0,
    };
  }
  const payload = splitFrontmatter(file.content ?? "");
  return {
    ...payload,
    id,
    name: id.split("/").pop()!,
    parentName: id.split("/").slice(-2, -1).join(""),
    bodyContent: payload.bodyContent,
    savedBodyContent: payload.bodyContent,
    diskNormalizedBody: "",
    initialContent: payload.bodyContent,
    viewKind:
      file.kind === "editor"
        ? "editor"
        : file.kind === "unsupported"
          ? "unsupported"
          : "preview",
    previewFormat:
      file.kind === "editor" || file.kind === "unsupported" ? null : file.kind,
    previewNonce: 0,
    isEphemeral: false,
    file,
    status: "idle",
    generation: 0,
  };
}
const treeQuery = (workspace: WorkspaceRef, signal?: AbortSignal) =>
  queryClient.fetchQuery({
    queryKey: ["workspace-tree", workspace.wsId],
    queryFn: () =>
      api<{ nodes: FileNode[]; warnings: string[] }>(
        "/api/tree",
        "GET",
        undefined,
        workspace,
        signal,
      ),
  });
const fileQuery = (workspace: WorkspaceRef, id: string, signal?: AbortSignal) =>
  queryClient.fetchQuery({
    queryKey: ["workspace-file", workspace.wsId, id],
    queryFn: () =>
      api<FileContent>(
        "/api/files/content?path=" + encodeURIComponent(id),
        "GET",
        undefined,
        workspace,
        signal,
      ),
  });
export const useStore = create<State>((set, get) => ({
  workspaces: storedWorkspaces(),
  workspace: null,
  nodes: [],
  tabs: [],
  activeTabId: null,
  viewGroups: [],
  activeViewGroupId: null,
  split: { left: null, right: null, active: "left", ratio: 0.5 },
  error: "",
  connectionError: "",
  ready: false,
  restoring: false,
  openingPhase: "idle",
  openingWorkspace: null,
  connectionStatus: "closed",
  scrollPositions: {},
  expanded: [],
  theme: "system",
  sidebarWidth: 300,
  recentFiles: [],
  setError: (message) => set({ error: message }),
  removeWorkspace(path) {
    const workspaces = removeWorkspaceFromList(get().workspaces, path);
    set({ workspaces });
    try {
      localStorage.setItem("maek:workspaces", JSON.stringify(workspaces));
    } catch {
      // Ignore persistence failures; the in-memory list is still updated.
    }
  },
  cancelWorkspaceOpen() {
    workspaceOpenEpoch++;
    workspaceOpenController?.abort();
    workspaceOpenController = undefined;
    const current = get();
    set({
      restoring: false,
      openingPhase: "idle",
      openingWorkspace: null,
      connectionStatus: current.workspace && current.ready ? "ready" : "closed",
    });
  },
  async openWorkspace(path) {
    const operation = ++workspaceOpenEpoch;
    workspaceOpenController?.abort();
    const controller = new AbortController();
    workspaceOpenController = controller;
    const isCurrent = () => operation === workspaceOpenEpoch;
    set({
      restoring: true,
      openingPhase: path ? "opening" : "selecting",
      openingWorkspace: null,
      connectionStatus: "opening",
      connectionError: "",
      error: "",
    });
    try {
      if (!(await get().saveAll())) return;
      if (!isCurrent()) return;
      const ws = path
        ? await api<WorkspaceRef>(
            "/api/workspaces/open",
            "POST",
            { path },
            null,
            controller.signal,
          )
        : await api<{
            status: string;
            workspace?: WorkspaceRef;
            reason?: string;
          }>(
            "/api/workspaces/pick",
            "POST",
            undefined,
            null,
            controller.signal,
          ).then((r) => {
            if (r.status === "canceled") return null;
            if (!r.workspace)
              throw new Error(
                r.reason ??
                  "Folder picker is unavailable. Enter the path below.",
              );
            return r.workspace;
          });
      if (!isCurrent()) return;
      if (!ws) {
        const current = get();
        set({
          connectionStatus:
            current.workspace && current.ready ? "ready" : "closed",
        });
        return;
      }
      set({ openingWorkspace: ws, openingPhase: "indexing" });
      await get().persist();
      if (!isCurrent()) return;
      const [tree, rootTabs, ui, recents] = await Promise.all([
        treeQuery(ws, controller.signal),
        api<RootTabs>(
          "/api/workspace/tabs",
          "GET",
          undefined,
          ws,
          controller.signal,
        ),
        api<UiState>(
          "/api/workspace/ui-state",
          "GET",
          undefined,
          ws,
          controller.signal,
        ),
        api<{ path: string; lastOpened: number }[]>(
          "/api/workspace/recent-files",
          "GET",
          undefined,
          ws,
          controller.signal,
        ),
      ]);
      if (!isCurrent()) return;
      set({ openingPhase: "restoring-tabs" });
      const tabs: Tab[] = [];
      for (const id of rootTabs.tabs) {
        const virtual=restoreVirtualTab(id);if(virtual){tabs.push(virtual);continue}
        try {
          const file = await fileQuery(ws, id, controller.signal);
          if (!isCurrent()) return;
          tabs.push(makeTab(id, file));
        } catch {
          if (!isCurrent() || controller.signal.aborted) return;
          /* Missing files do not resurrect. */
        }
      }
      if (!isCurrent()) return;
      events?.close();
      sessionEpoch++;
      setHostWorkspace(ws);
      // Per-browser selection wins; fall back to the root document's active tab,
      // then the first restored tab.
      const preferredActive =
        ui.activeTabId && tabs.some((t) => t.id === ui.activeTabId)
          ? ui.activeTabId
          : rootTabs.activeTabId &&
              tabs.some((t) => t.id === rootTabs.activeTabId)
            ? rootTabs.activeTabId
            : (tabs[0]?.id ?? null);
      const viewGroups = groupsFromUi(tabs, ui);
      const activeViewGroup =
        viewGroups.find((group) => group.id === ui.activeViewGroupId) ??
        viewGroups.find((group) => groupTabIds(group).includes(preferredActive ?? "")) ??
        viewGroups[0] ?? null;
      const activeTabId = activeViewGroup
        ? groupActiveTabId(activeViewGroup)
        : preferredActive;
      set({
        workspace: ws,
        nodes: tree.nodes,
        workspaces: [
          ...new Map(
            [
              { id: ws.wsId, name: ws.name, path: ws.root },
              ...get().workspaces,
            ].map((w) => [w.path, w]),
          ).values(),
        ].slice(0, 30),
        tabs,
        viewGroups,
        activeViewGroupId: activeViewGroup?.id ?? null,
        activeTabId,
        scrollPositions: ui.scrollPositions,
        expanded: ui.expanded,
        theme: ui.theme,
        sidebarWidth: ui.sidebarWidth,
        split: activeViewGroup
          ? groupSplit(activeViewGroup)
          : { left: preferredActive, right: null, active: "left", ratio: 0.5 },
        recentFiles: recents,
        ready: true,
        openingWorkspace: null,
        error: tree.warnings.length
          ? `Cannot read: ${tree.warnings.join(", ")}`
          : "",
      });
      localStorage.setItem("maek:workspace", ws.root);
      localStorage.setItem(
        "maek:workspaces",
        JSON.stringify(get().workspaces),
      );
      tabsDirty = false;
      later();
      document.documentElement.dataset.theme = resolveTheme(
        ui.theme,
        systemPrefersDark(),
      );
      connectEvents(ws, set, get);
    } catch (e) {
      if (!isCurrent() || controller.signal.aborted) return;
      set({ connectionStatus: "failed", error: String(e) });
    } finally {
      if (isCurrent()) {
        workspaceOpenController = undefined;
        set({
          restoring: false,
          openingPhase: "idle",
          openingWorkspace: null,
        });
      }
    }
  },
  async reconnectWorkspace() {
    const current = get().workspace;
    if (!current || get().restoring) return;
    set({ restoring: true, connectionStatus: "reconnecting" });
    try {
      const ws = await api<WorkspaceRef>(
        "/api/workspaces/open",
        "POST",
        { path: current.root },
        null,
      );
      if (get().workspace?.root !== current.root) return;
      sessionEpoch++;
      setHostWorkspace(ws);
      set({ workspace: ws });
      connectEvents(ws, set, get);
      await get().refresh();
    } catch (error) {
      set({
        connectionStatus: "failed",
        connectionError: "Connection interrupted. Reconnecting…",
      });
      const delay = Math.min(500 * 2 ** reconnectAttempt++, 5000);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(
        () => void get().reconnectWorkspace(),
        delay,
      );
    } finally {
      set({ restoring: false });
    }
  },
  async refresh() {
    try {
      const epoch = sessionEpoch;
      const workspace = get().workspace;
      if (!workspace) return;
      await queryClient.invalidateQueries({
        queryKey: ["workspace-tree", workspace.wsId],
      });
      const tree = await treeQuery(workspace);
      if (epoch !== sessionEpoch) return;
      set({
        nodes: tree.nodes,
        error: tree.warnings.length
          ? `Cannot read: ${tree.warnings.join(", ")}`
          : "",
      });
      for (const t of get().tabs) {
        if (isVirtualTabId(t.id)) continue;
        await get().change({
          type: tree.nodes.some((n) => n.id === t.id) ? "change" : "unlink",
          path: t.id,
        });
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },
  async openFile(id, options = {}) {
    const preview = options.preview === true;
    const fromRoute = options.source === "route";
    void recordRecent(id);
    const existing = get().tabs.find((t) => t.id === id);
    const activePreview = get().tabs.find(
      (t) => t.id === get().activeTabId && t.isEphemeral,
    );
    // A preview selection updates the URL after it changes activeTabId. While
    // that update is in flight, a stale URL event may still reference the
    // previous preview. It must not reopen that old file as a permanent tab.
    if (fromRoute && activePreview && activePreview.id !== id) return;
    if (existing) {
      // A double-click (or any explicit open) promotes the preview in place.
      // That keeps its editor state instead of closing and reopening the file.
      if (!preview && !fromRoute && existing.isEphemeral) {
        patchTab(id, (t) => ({ ...t, isEphemeral: false }));
        tabsDirty = true;
      }
      get().setActiveTab(id);
      if (!preview && !fromRoute && existing.isEphemeral) later();
      return;
    }
    try {
      const epoch = sessionEpoch;
      const workspace = get().workspace;
      if (!workspace) return;
      const file = await fileQuery(workspace, id);
      if (epoch !== sessionEpoch) return;
      set((s) => {
        // Preview click and double-click can race their file reads. Resolve the
        // duplicate at commit time, not only before the await, so a file keeps
        // one tab and one view group.
        const current = s.tabs.find((tab) => tab.id === id);
        const currentGroup = s.viewGroups.find((group) => groupTabIds(group).includes(id));
        if (current && currentGroup) {
          const tabs = !preview && current.isEphemeral
            ? s.tabs.map((tab) => tab.id === id ? { ...tab, isEphemeral: false } : tab)
            : s.tabs;
          const pane: "left" | "right" = currentGroup.kind === "split" && currentGroup.right === id ? "right" : "left";
          const viewGroups = currentGroup.kind === "split"
            ? s.viewGroups.map((group) => group.id === currentGroup.id && group.kind === "split"
              ? { ...group, active: pane }
              : group)
            : s.viewGroups;
          const group = viewGroups.find((item) => item.id === currentGroup.id)!;
          return {
            tabs, viewGroups, activeViewGroupId: group.id, activeTabId: id,
            split: groupSplit(group), error: "",
          };
        }
        const nextTab = { ...makeTab(id, file), isEphemeral: preview };
        const activeGroup = s.viewGroups.find((group) => group.id === s.activeViewGroupId);
        const replacedPreviewId = preview && activeGroup?.kind === "single" &&
          s.tabs.find((tab) => tab.id === activeGroup.tabId)?.isEphemeral
          ? activeGroup.tabId
          : null;
        const tabs = replacedPreviewId
          ? [...s.tabs.filter((tab) => tab.id !== replacedPreviewId), nextTab]
          : [...s.tabs, nextTab];
        const replacementGroup = replacedPreviewId && activeGroup
          ? { ...activeGroup, tabId: id } as ViewGroup
          : singleViewGroup(id);
        const viewGroups = replacedPreviewId
          ? s.viewGroups.map((group) => group.id === replacementGroup.id ? replacementGroup : group)
          : [...s.viewGroups, replacementGroup];
        return {
          tabs,
          viewGroups,
          activeViewGroupId: replacementGroup.id,
          activeTabId: id,
          split: groupSplit(replacementGroup),
          recentFiles: [
            { path: id, lastOpened: Date.now() },
            ...s.recentFiles.filter((f) => f.path !== id),
          ].slice(0, 200),
          error: "",
        };
      });
      // Preview tabs are deliberately session-only. A permanent open (or a
      // replaced preview) changes the shared tab list.
      if (!preview || Boolean(activePreview)) tabsDirty = true;
      later();
    } catch (e) {
      set({ error: String(e) });
    }
  },
  async openFileToSide(id) {
    if (get().tabs.some((tab) => tab.id === id)) {
      // A file already belongs to an Open Tabs workspace. Focus that workspace
      // instead of stealing it into the current split.
      get().setActiveTab(id);
      return;
    }
    void recordRecent(id);
    try {
      const epoch = sessionEpoch;
      const workspace = get().workspace;
      if (!workspace) return;
      const existing = get().tabs.find((t) => t.id === id);
      const tab = existing ?? makeTab(id, await fileQuery(workspace, id));
      if (epoch !== sessionEpoch) return;
      set((s) => {
        const activeGroup = s.viewGroups.find((group) => group.id === s.activeViewGroupId);
        if (!activeGroup) {
          const group = singleViewGroup(id);
          return {
            tabs: [...s.tabs, tab], viewGroups: [...s.viewGroups, group],
            activeViewGroupId: group.id, activeTabId: id, split: groupSplit(group), error: "",
          };
        }
        const target: "left" | "right" = activeGroup.kind === "split"
          ? activeGroup.active === "left" ? "right" : "left"
          : "right";
        const replacement: ViewGroup = activeGroup.kind === "single"
          ? {
              id: activeGroup.id, kind: "split" as const, left: activeGroup.tabId, right: id,
              active: target, ratio: 0.5,
            }
          : { ...activeGroup, [target]: id, active: target };
        const displaced = activeGroup.kind === "split" ? activeGroup[target] : null;
        const groupIndex = s.viewGroups.findIndex((group) => group.id === activeGroup.id);
        const viewGroups = s.viewGroups.map((group) => group.id === replacement.id ? replacement : group);
        if (displaced && displaced !== id)
          viewGroups.splice(groupIndex + 1, 0, singleViewGroup(displaced));
        return {
          tabs: s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, tab],
          viewGroups,
          activeViewGroupId: replacement.id,
          activeTabId: id,
          split: groupSplit(replacement),
          error: "",
        };
      });
      if (!existing) tabsDirty = true;
      later();
    } catch (e) {
      set({ error: String(e) });
    }
  },
  setSplitActive(pane) {
    const activeGroup = get().viewGroups.find((group) => group.id === get().activeViewGroupId);
    if (!activeGroup || activeGroup.kind !== "split") return;
    const id = pane === "left" ? activeGroup.left : activeGroup.right;
    invalidateTabFocus();
    const previous = get().activeTabId;
    if (previous && previous !== id) void get().save(previous);
    set((s) => {
      const viewGroups = s.viewGroups.map((group) =>
        group.id === activeGroup.id && group.kind === "split"
          ? { ...group, active: pane }
          : group,
      );
      const group = viewGroups.find((item) => item.id === activeGroup.id)!;
      return { viewGroups, activeTabId: id, split: groupSplit(group) };
    });
    later();
  },
  setSplitRatio(ratio) {
    const clamped = Math.min(.75, Math.max(.25, ratio));
    set((s) => {
      const viewGroups = s.viewGroups.map((group) =>
        group.id === s.activeViewGroupId && group.kind === "split"
          ? { ...group, ratio: clamped }
          : group,
      );
      const group = viewGroups.find((item) => item.id === s.activeViewGroupId);
      return { viewGroups, split: group ? groupSplit(group) : { ...s.split, ratio: clamped } };
    });
    later();
  },
  singlePane(pane) {
    invalidateTabFocus();
    paneOpenIntent.left++;
    paneOpenIntent.right++;
    set((s) => {
      const current = s.viewGroups.find((group) => group.id === s.activeViewGroupId);
      if (!current || current.kind !== "split") return {};
      const selected = pane === "left" ? current.left : current.right;
      const other = pane === "left" ? current.right : current.left;
      const selectedGroup: ViewGroup = { id: current.id, kind: "single", tabId: selected };
      const otherGroup = singleViewGroup(other);
      const index = s.viewGroups.findIndex((group) => group.id === current.id);
      const viewGroups = [...s.viewGroups];
      viewGroups.splice(index, 1, selectedGroup, otherGroup);
      return {
        viewGroups, activeViewGroupId: selectedGroup.id, activeTabId: selected,
        split: groupSplit(selectedGroup),
      };
    });
    later();
  },
  setActiveTab(id) {
    const target = get().viewGroups.find((group) => groupTabIds(group).includes(id));
    if (!target) return;
    const pane: "left" | "right" = target.kind === "split" && target.right === id ? "right" : "left";
    invalidatePaneOpen(pane);
    const previous = get().activeTabId;
    if (previous && previous !== id) void get().save(previous);
    set((s) => {
      const viewGroups = s.viewGroups.map((group) =>
        group.id === target.id && group.kind === "split" ? { ...group, active: pane } : group,
      );
      const activeGroup = viewGroups.find((group) => group.id === target.id)!;
      return {
        viewGroups, activeViewGroupId: target.id, activeTabId: id, split: groupSplit(activeGroup),
      };
    });
    later();
  },
  setActiveViewGroup(id) {
    const group = get().viewGroups.find((item) => item.id === id);
    if (!group) return;
    get().setActiveTab(groupActiveTabId(group));
  },
  reorderTabs(fromIndex, insertionIndex) {
    const tabs = [...get().tabs];
    if (
      fromIndex < 0 ||
      fromIndex >= tabs.length ||
      insertionIndex < 0 ||
      insertionIndex > tabs.length
    )
      return;
    const [moving] = tabs.splice(fromIndex, 1);
    if (!moving) return;
    // The insertion index refers to the pre-removal list; shift it left when
    // the moved item sat before the insertion point.
    const target = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
    if (target === fromIndex) return; // No-op self drop.
    tabs.splice(target, 0, moving);
    set({ tabs });
    tabsDirty = true;
    later();
  },
  reorderViewGroups(fromIndex, insertionIndex) {
    set((s) => {
      if (fromIndex < 0 || fromIndex >= s.viewGroups.length ||
          insertionIndex < 0 || insertionIndex > s.viewGroups.length) return {};
      const viewGroups = [...s.viewGroups];
      const [moving] = viewGroups.splice(fromIndex, 1);
      if (!moving) return {};
      const target = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
      if (target === fromIndex) return {};
      viewGroups.splice(target, 0, moving);
      const orderedIds = viewGroups.flatMap(groupTabIds);
      const byId = new Map(s.tabs.map((tab) => [tab.id, tab]));
      const tabs = orderedIds.map((id) => byId.get(id)).filter((tab): tab is Tab => Boolean(tab));
      return { viewGroups, tabs };
    });
    tabsDirty = true;
    later();
  },
  async syncTabsFromRoot() {
    const workspace = get().workspace;
    if (!workspace || !get().ready) return;
    // A local tab-list change is pending persist; let it win rather than
    // reverting to a stale document. Our own write will re-sync afterwards.
    if (tabsDirty) return;
    const epoch = sessionEpoch;
    let snapshot: RootTabs;
    try {
      snapshot = await api<RootTabs>("/api/workspace/tabs", "GET", undefined, workspace);
    } catch {
      return;
    }
    if (epoch !== sessionEpoch) return;
    const current = get().tabs;
    const currentFileIds = current.filter(isSharedTab).map((t) => t.id);
    // Loop guard: our own write echoes back through the watcher. When the file
    // tab order already matches the document there is nothing to do.
    const sameOrder =
      currentFileIds.length === snapshot.tabs.length &&
      currentFileIds.every((id, i) => id === snapshot.tabs[i]);
    if (sameOrder) return;
    const byId = new Map(current.map((t) => [t.id, t]));
    // Externally removed file tabs: try to save dirty ones first, then close.
    const removed = currentFileIds.filter((id) => !snapshot.tabs.includes(id));
    const keptDueToConflict = new Set<string>();
    for (const id of removed) {
      const tab = byId.get(id);
      if (tab && isTabDirty(tab)) {
        const saved = await get().save(id);
        if (epoch !== sessionEpoch) return;
        if (!saved) {
          keptDueToConflict.add(id);
          patchTab(id, (t) => ({
            ...t,
            status: t.status === "conflict" ? "conflict" : "error",
            error:
              t.error ??
              "This note was closed elsewhere but has unsaved changes.",
          }));
        }
      }
    }
    // Rebuild the ordered file-tab list from the document, reusing live tab
    // objects; load any newly opened file tabs.
    const nextFileTabs: Tab[] = [];
    for (const id of snapshot.tabs) {
      const virtual=restoreVirtualTab(id);if(virtual){nextFileTabs.push(byId.get(id)??virtual);continue}
      const existing = byId.get(id);
      if (existing) {
        nextFileTabs.push(existing);
        continue;
      }
      try {
        const file = await fileQuery(workspace, id);
        if (epoch !== sessionEpoch) return;
        nextFileTabs.push(makeTab(id, file));
      } catch {
        /* Missing files do not resurrect. */
      }
    }
    // Re-add tabs we could not close due to a save conflict.
    for (const id of keptDueToConflict) {
      const tab = byId.get(id);
      if (tab && !nextFileTabs.some((t) => t.id === id)) nextFileTabs.push(tab);
    }
    // Virtual tabs (dashboard/kanban) are client-only; keep them at the end.
    const virtualTabs = current.filter(t=>!isSharedTab(t));
    const nextTabs = [...nextFileTabs, ...virtualTabs];
    const previousActive = get().activeTabId;
    const activeStillOpen =
      previousActive && nextTabs.some((t) => t.id === previousActive);
    const viewGroups = reconcileViewGroups(get().viewGroups, nextTabs);
    const activeGroup =
      viewGroups.find((group) => group.id === get().activeViewGroupId) ??
      viewGroups.find((group) => groupTabIds(group).includes(previousActive ?? "")) ??
      viewGroups[0] ?? null;
    set({
      tabs: nextTabs,
      viewGroups,
      activeViewGroupId: activeGroup?.id ?? null,
      // Only move selection when the active tab was removed externally.
      activeTabId: activeStillOpen && previousActive && activeGroup
        ? previousActive
        : (activeGroup ? groupActiveTabId(activeGroup) : null),
      split: activeGroup ? groupSplit(activeGroup) : { left: null, right: null, active: "left", ratio: .5 },
    });
    // We just adopted the document's order; nothing for us to write back.
    tabsDirty = false;
    // Persist the per-browser selection change without rewriting the root doc
    // (order already matches the document we just read).
    void get().persist();
  },
  openDashboard() {
    const existing = get().tabs.find((t) => t.id === DASHBOARD_TAB_ID);
    if (existing) {
      get().setActiveTab(DASHBOARD_TAB_ID);
      return;
    }
    invalidatePaneOpen(get().split.active);
    set((s) => {
      const group = singleViewGroup(DASHBOARD_TAB_ID);
      return {
        tabs: [...s.tabs, makeVirtualTab(DASHBOARD_TAB_ID, "Home", "workspace-settings")],
        viewGroups: [...s.viewGroups, group], activeViewGroupId: group.id,
        activeTabId: DASHBOARD_TAB_ID, split: groupSplit(group),
      };
    });
    tabsDirty=true;
    later();
  },
  openKanban(folderPath) {
    const id = kanbanTabId(folderPath);
    if (get().tabs.some((t) => t.id === id)) {
      get().setActiveTab(id);
      return;
    }
    invalidatePaneOpen(get().split.active);
    const name = folderPath ? (folderPath.split("/").pop() ?? "") : "Workspace";
    set((s) => {
      const group = singleViewGroup(id);
      return {
        tabs: [...s.tabs, makeVirtualTab(id, `${name} Kanban`, "kanban", folderPath)],
        viewGroups: [...s.viewGroups, group], activeViewGroupId: group.id,
        activeTabId: id, split: groupSplit(group),
      };
    });
    later();
  },
  openDatabase(folderPath, displayName) {
    const id = databaseTabId(folderPath);
    if (get().tabs.some((t) => t.id === id)) {
      get().setActiveTab(id);
      return;
    }
    invalidatePaneOpen(get().split.active);
    const name = displayName ?? folderPath.split("/").pop() ?? "Database";
    set((s) => {
      const group = singleViewGroup(id);
      return {
        tabs: [...s.tabs, makeVirtualTab(id, name, "database", folderPath)],
        viewGroups: [...s.viewGroups, group], activeViewGroupId: group.id,
        activeTabId: id, split: groupSplit(group),
      };
    });
    tabsDirty=true;
    later();
  },
  clearRecentFiles() {
    void api<State["recentFiles"]>("/api/workspace/recent-files", "POST", {action:"clear"}).then(recentFiles=>set({recentFiles})).catch(e=>set({error:String(e)}));
    later();
  },
  updateBody(id, body, options = {}) {
    const wasEphemeral = get().tabs.find((t) => t.id === id)?.isEphemeral;
    patchTab(id, (t) => ({
      ...t,
      // Editing a preview must make it permanent before an unrelated file
      // selection can replace it.
      isEphemeral: options.pin === false ? t.isEphemeral : false,
      bodyContent: body,
      status: t.status === "conflict" ? "conflict" : "idle",
    }));
    if (wasEphemeral && options.pin !== false) {
      tabsDirty = true;
      later();
    }
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => void get().save(id), 1500),
    );
  },
  rebase(id, body) {
    patchTab(id, (t) => ({
      ...t,
      bodyContent: body,
      savedBodyContent: body,
      diskNormalizedBody: body,
    }));
  },
  async save(id) {
    const inFlight = saves.get(id);
    if (inFlight) {
      await inFlight;
      return get().save(id);
    }
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab || !isTabDirty(tab)) return true;
    if (tab.status === "conflict") return false;
    if (tab.viewKind !== "spreadsheet" && tab.frontmatter.validationError) {
      patchTab(id, (t) => ({
        ...t,
        status: "error",
        error: "Fix invalid frontmatter before saving",
      }));
      return false;
    }
    clearTimeout(timers.get(id));
    const epoch = sessionEpoch;
    const content = getTabFileContent(tab);
    patchTab(id, (t) => ({ ...t, status: "saving", error: undefined }));
    const task = (async () => {
      try {
        const result = await api<{ hash: string; mtimeMs: number }>(
          "/api/files/content",
          "PUT",
          {
            path: id,
            content,
            baseHash: tab.file.hash,
            baseMtimeMs: tab.file.mtimeMs,
          },
        );
        if (epoch !== sessionEpoch) return false;
        patchTab(id, (t) => ({
          ...t,
          savedBodyContent: tab.bodyContent,
          diskNormalizedBody: tab.bodyContent,
          frontmatter: { ...t.frontmatter, savedRaw: tab.frontmatter.raw },
          diskFileContent: content,
          file: { ...t.file, ...result, content },
          status: "saved",
        }));
        if (get().workspace) {
          queryClient.setQueryData(
            ["workspace-file", get().workspace!.wsId, id],
            { ...tab.file, ...result, content },
          );
        }
        return true;
      } catch (e) {
        if (epoch === sessionEpoch)
          patchTab(id, (t) => ({
            ...t,
            status:
              e instanceof ApiError && e.status === 409 ? "conflict" : "error",
            error: String(e),
          }));
        return false;
      }
    })();
    saves.set(id, task);
    let success: boolean;
    try {
      success = await task;
    } finally {
      saves.delete(id);
    }
    if (success && get().tabs.some((t) => t.id === id && isTabDirty(t)))
      return get().save(id);
    return success;
  },
  async saveAll() {
    const results = await Promise.all(get().tabs.map((t) => get().save(t.id)));
    return results.every(Boolean);
  },
  async closeTab(id) {
    if (!(await get().save(id))) return;
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const viewGroups = s.viewGroups.flatMap((group): ViewGroup[] => {
        if (group.kind === "single") return group.tabId === id ? [] : [group];
        if (group.left !== id && group.right !== id) return [group];
        const tabId = group.left === id ? group.right : group.left;
        return [{ id: group.id, kind: "single", tabId }];
      });
      const activeGroup =
        viewGroups.find((group) => group.id === s.activeViewGroupId) ??
        viewGroups.at(-1) ?? null;
      return {
        tabs,
        viewGroups,
        activeViewGroupId: activeGroup?.id ?? null,
        activeTabId: activeGroup ? groupActiveTabId(activeGroup) : null,
        split: activeGroup ? groupSplit(activeGroup) : { left: null, right: null, active: "left", ratio: .5 },
      };
    });
    tabsDirty = true;
    later();
  },
  async closeViewGroup(id) {
    const group = get().viewGroups.find((item) => item.id === id);
    if (!group) return;
    // Save every member before mutating anything, so a failed save leaves the
    // whole workspace intact instead of half-closed.
    for (const tabId of groupTabIds(group)) {
      if (!(await get().save(tabId))) return;
    }
    set((s) => {
      const index = s.viewGroups.findIndex((item) => item.id === id);
      const viewGroups = s.viewGroups.filter((item) => item.id !== id);
      const closed = new Set(groupTabIds(group));
      const tabs = s.tabs.filter((tab) => !closed.has(tab.id));
      const activeGroup =
        viewGroups[index] ?? viewGroups[index - 1] ?? viewGroups.at(-1) ?? null;
      return {
        tabs, viewGroups, activeViewGroupId: activeGroup?.id ?? null,
        activeTabId: activeGroup ? groupActiveTabId(activeGroup) : null,
        split: activeGroup ? groupSplit(activeGroup) : { left: null, right: null, active: "left", ratio: .5 },
      };
    });
    tabsDirty = true;
    later();
  },
  async reload(id) {
    try {
      const workspace = get().workspace;
      if (!workspace) return;
      await queryClient.invalidateQueries({
        queryKey: ["workspace-file", workspace.wsId, id],
      });
      const file = await fileQuery(workspace, id);
      patchTab(id, (t) => ({
        ...makeTab(id, file),
        generation: t.generation + 1,
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },
  refreshPreview(id) {
    patchTab(id, (tab) => ({
      ...tab,
      previewNonce: tab.previewNonce + 1,
    }));
  },
  async change(event) {
    window.dispatchEvent(new CustomEvent("maek:workspace-change", { detail: event }));
    if (event.path.endsWith("/.maek-database.json") || event.path === ".maek-database.json") return;
    if(event.path.startsWith('.maek/')) {
      if(event.path==='.maek/recentFiles.json') {
        const recentFiles=await api<State['recentFiles']>('/api/workspace/recent-files');set({recentFiles});
      }
      return;
    }
    const epoch = sessionEpoch;
    if (event.type === "rename" && event.source) {
      const source = event.source,
        dest = event.path;
      const replace = (p: string): string => remapTabIdForRename(p, source, dest);
      set((s) => ({
        nodes: [
          ...new Map(
            s.nodes.map((n) => {
              const id = replace(n.id);
              return [
                id,
                {
                  ...n,
                  id,
                  name: id.split("/").pop()!,
                  parent: id.split("/").slice(0, -1).join("/") || null,
                },
              ] as const;
            }),
          ).values(),
        ],
        tabs: s.tabs.map((t) => remapTabForRename(t, source, dest)),
        viewGroups: remapViewGroups(s.viewGroups, replace),
        activeTabId: s.activeTabId ? replace(s.activeTabId) : null,
        split: {
          ...s.split,
          left: s.split.left ? replace(s.split.left) : null,
          right: s.split.right ? replace(s.split.right) : null,
        },
        scrollPositions: Object.fromEntries(
          Object.entries(s.scrollPositions).map(([p, v]) => [replace(p), v]),
        ),
        expanded: s.expanded.map(replace),
        recentFiles: s.recentFiles.map((f) => ({
          ...f,
          path: replace(f.path),
        })),
      }));
      for (const [id, timer] of timers) {
        if (id === source || id.startsWith(source + "/")) {
          clearTimeout(timer);
          timers.delete(id);
          const renamed = replace(id);
          timers.set(
            renamed,
            setTimeout(() => void get().save(renamed), 1500),
          );
        }
      }
      if (
        get().tabs.some((t) => t.id === dest || t.id.startsWith(dest + "/"))
      )
        tabsDirty = true;
      later();
      return;
    }
    set((s) => ({
      nodes: event.node
        ? [...s.nodes.filter((n) => n.id !== event.path), event.node].sort(
            (a, b) =>
              Number(b.isDir) - Number(a.isDir) ||
              a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
          )
        : event.type.startsWith("unlink")
          ? s.nodes.filter(
              (n) => n.id !== event.path && !n.id.startsWith(event.path + "/"),
            )
          : s.nodes,
    }));
    for (const tab of get().tabs.filter(
      (t) =>
        t.id === event.path ||
        (event.type === "unlinkDir" && t.id.startsWith(event.path + "/")),
    )) {
      if (saves.has(tab.id)) await saves.get(tab.id);
      if (epoch !== sessionEpoch) return;
      const current = get().tabs.find((t) => t.id === tab.id);
      if (!current) continue;
      if (event.type.startsWith("unlink")) {
        patchTab(tab.id, (t) => ({
          ...t,
          status: "conflict",
          error:
            "File was deleted or moved externally. Save a copy or close this tab.",
        }));
        continue;
      }
      try {
        const workspace = get().workspace;
        if (!workspace) return;
        await queryClient.invalidateQueries({
          queryKey: ["workspace-file", workspace.wsId, tab.id],
        });
        const file = await fileQuery(workspace, tab.id);
        if (epoch !== sessionEpoch) return;
        const latest = get().tabs.find((t) => t.id === tab.id);
        if (!latest || (file.hash && file.hash === latest.file.hash)) continue;
        if (isTabDirty(latest))
          patchTab(tab.id, (t) => ({
            ...t,
            status: "conflict",
            error: "File changed externally. Your edits are preserved.",
          }));
        else
          patchTab(tab.id, (t) => ({
            ...makeTab(tab.id, file),
            generation: t.generation + 1,
          }));
      } catch (e) {
        set({ error: String(e) });
      }
    }
  },
  applyMoveToState(source, dest) {
    const replace = (p: string): string => remapTabIdForRename(p, source, dest);
    set((s) => ({
      tabs: s.tabs.map((t) => remapTabForRename(t, source, dest)),
      viewGroups: remapViewGroups(s.viewGroups, replace),
      activeTabId: s.activeTabId ? replace(s.activeTabId) : null,
      split: {
        ...s.split,
        left: s.split.left ? replace(s.split.left) : null,
        right: s.split.right ? replace(s.split.right) : null,
      },
      scrollPositions: Object.fromEntries(
        Object.entries(s.scrollPositions).map(([p, v]) => [replace(p), v]),
      ),
      expanded: s.expanded.map(replace),
      recentFiles: s.recentFiles.map((f) => ({ ...f, path: replace(f.path) })),
    }));
    if (get().tabs.some((t) => t.id === dest || t.id.startsWith(dest + "/")))
      tabsDirty = true;
  },
  async move(source, dest) {
    if (!(await get().saveAll())) return;
    await api("/api/files/path", "PATCH", { source, dest });
    get().applyMoveToState(source, dest);
    await get().refresh();
    later();
  },
  updateFrontmatterRaw(id, raw) {
    patchTab(id, (t) => ({
      ...t,
      frontmatter: {
        ...t.frontmatter,
        hasFrontmatter: true,
        raw,
        validationError: validateFrontmatterYaml(raw),
      },
    }));
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => void get().save(id), 1500),
    );
  },
  toggleFrontmatterExpanded(id) {
    patchTab(id, (t) => ({
      ...t,
      frontmatter: { ...t.frontmatter, expanded: !t.frontmatter.expanded },
    }));
  },
  setFrontmatterViewMode(id, viewMode) {
    patchTab(id, (t) => ({
      ...t,
      frontmatter: { ...t.frontmatter, viewMode },
    }));
  },
  async persist() {
    const s = get();
    if (!s.workspace || !s.ready) return;
    const fileTabs = s.tabs.filter(isSharedTab).map((t) => t.id);
    const activeFileTab =
      s.activeTabId && fileTabs.includes(s.activeTabId) ? s.activeTabId : null;
    const ui: UiState = {
      activeTabId: activeFileTab,
      scrollPositions: s.scrollPositions,
      expanded: s.expanded,
      theme: s.theme,
      sidebarWidth: s.sidebarWidth,
      split: s.split,
      viewGroups: s.viewGroups,
      activeViewGroupId: s.activeViewGroupId,
    };
    try {
      const writes: Promise<unknown>[] = [
        api("/api/workspace/ui-state", "PUT", ui, s.workspace),

      ];
      // Only rewrite the shared root document when this browser changed the
      // open-tab list. UI-only autosaves must never touch it, so an idle
      // browser cannot clobber an external edit and the watcher does not loop.
      if (tabsDirty) {
        const rootTabs: RootTabs = { tabs: fileTabs, activeTabId: activeFileTab };
        writes.push(api("/api/workspace/tabs", "PUT", rootTabs, s.workspace));
        tabsDirty = false;
      }
      await Promise.all(writes);
    } catch (e) {
      set({ error: "Session could not be saved: " + String(e) });
    }
  },
}));
export function schedulePersistence() {
  later();
}
window.addEventListener("blur", () => {
  void useStore.getState().saveAll();
  void useStore.getState().persist();
});
window.addEventListener("beforeunload", (e) => {
  if (
    useStore.getState().tabs.some((t) => isTabDirty(t) || t.status === "saving")
  ) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function recordRecent(id: string) {
  const workspace=useStore.getState().workspace;
  if(!workspace)return;
  try {
    const recentFiles=await api<State['recentFiles']>('/api/workspace/recent-files','POST',{action:'open',path:id},workspace);
    if(useStore.getState().workspace?.wsId===workspace.wsId)useStore.setState({recentFiles});
  } catch(e){useStore.getState().setError(String(e))}
}
export async function clearSharedTabs() {
  if(!await useStore.getState().saveAll())throw new Error('Save unsaved notes before clearing tabs');
  clearTimeout(persistenceTimer);
  await useStore.getState().persist();
  tabsDirty=false;
  await api('/api/workspace/reset','POST',{action:'tabs'});
  useStore.setState(s=>({tabs:s.tabs.filter(t=>t.viewKind==='workspace-settings'),activeTabId:s.tabs.find(t=>t.viewKind==='workspace-settings')?.id??null}));
}
