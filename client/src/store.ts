import { create } from "zustand";
import type { WorkspaceRef } from "@shared/contract";
import type { FileNode, FileContent, Session, Change } from "@shared/workspace";
import type { TabItem, FrontmatterViewMode } from "./features/editor/types";
import {
  splitFrontmatter,
  isTabDirty,
  getTabFileContent,
  validateFrontmatterYaml,
} from "./features/editor/utils/frontmatter";
import { api, ApiError, setHostWorkspace } from "./host";
import { queryClient } from "./app/query-client";

export interface Tab extends TabItem {
  file: FileContent;
  initialContent: string;
  status: "idle" | "saving" | "saved" | "conflict" | "error";
  error?: string;
  generation: number;
}
interface State {
  workspaces: { id: string; name: string; path: string }[];
  workspace: WorkspaceRef | null;
  nodes: FileNode[];
  tabs: Tab[];
  activeTabId: string | null;
  error: string;
  connectionError: string;
  ready: boolean;
  restoring: boolean;
  openingPhase: "idle" | "selecting" | "opening" | "indexing" | "restoring-tabs";
  openingWorkspace: WorkspaceRef | null;
  connectionStatus: "closed" | "opening" | "ready" | "reconnecting" | "failed";
  scrollPositions: Record<string, number>;
  expanded: string[];
  theme: "light" | "dark";
  sidebarWidth: number;
  recentFiles: { path: string; lastOpened: number }[];
  openWorkspace: (path?: string) => Promise<void>;
  cancelWorkspaceOpen: () => void;
  reconnectWorkspace: () => Promise<void>;
  refresh: () => Promise<void>;
  openFile: (id: string) => Promise<void>;
  openDashboard: () => void;
  openKanban: (folderPath: string) => void;
  clearRecentFiles: () => void;
  save: (id: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  closeTab: (id: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  updateBody: (id: string, body: string) => void;
  rebase: (id: string, body: string) => void;
  reload: (id: string) => Promise<void>;
  change: (event: Change) => Promise<void>;
  move: (source: string, dest: string) => Promise<void>;
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
export function isVirtualTabId(id: string): boolean {
  return id.startsWith("maek:virtual:");
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
  viewKind: "workspace-settings" | "kanban",
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
    file: VIRTUAL_FILE,
    initialContent: "",
    status: "idle",
    generation: 0,
  };
}

function makeTab(id: string, file: FileContent): Tab {
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
  error: "",
  connectionError: "",
  ready: false,
  restoring: false,
  openingPhase: "idle",
  openingWorkspace: null,
  connectionStatus: "closed",
  scrollPositions: {},
  expanded: [],
  theme: "light",
  sidebarWidth: 260,
  recentFiles: [],
  setError: (message) => set({ error: message }),
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
      const [tree, session, recents] = await Promise.all([
        treeQuery(ws, controller.signal),
        api<Session>(
          "/api/workspace/tabs",
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
      for (const id of session.tabs) {
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
        activeTabId: tabs.some((t) => t.id === session.activeTabId)
          ? session.activeTabId
          : (tabs[0]?.id ?? null),
        scrollPositions: session.scrollPositions,
        expanded: session.expanded,
        theme: session.theme,
        sidebarWidth: session.sidebarWidth,
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
      later();
      document.documentElement.dataset.theme = session.theme;
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
  async openFile(id) {
    if (get().tabs.some((t) => t.id === id)) {
      get().setActiveTab(id);
      return;
    }
    try {
      const epoch = sessionEpoch;
      const workspace = get().workspace;
      if (!workspace) return;
      const file = await fileQuery(workspace, id);
      if (epoch !== sessionEpoch) return;
      set((s) => ({
        tabs: s.tabs.some((t) => t.id === id)
          ? s.tabs
          : [...s.tabs, makeTab(id, file)],
        activeTabId: id,
        recentFiles: [
          { path: id, lastOpened: Date.now() },
          ...s.recentFiles.filter((f) => f.path !== id),
        ].slice(0, 200),
        error: "",
      }));
      later();
    } catch (e) {
      set({ error: String(e) });
    }
  },
  setActiveTab(id) {
    const previous = get().activeTabId;
    if (previous && previous !== id) void get().save(previous);
    set({ activeTabId: id });
    later();
  },
  openDashboard() {
    const existing = get().tabs.find((t) => t.id === DASHBOARD_TAB_ID);
    if (existing) {
      get().setActiveTab(DASHBOARD_TAB_ID);
      return;
    }
    set((s) => ({
      tabs: [
        ...s.tabs,
        makeVirtualTab(DASHBOARD_TAB_ID, "Dashboard", "workspace-settings"),
      ],
      activeTabId: DASHBOARD_TAB_ID,
    }));
    later();
  },
  openKanban(folderPath) {
    const id = kanbanTabId(folderPath);
    if (get().tabs.some((t) => t.id === id)) {
      get().setActiveTab(id);
      return;
    }
    const name = folderPath ? (folderPath.split("/").pop() ?? "") : "Workspace";
    set((s) => ({
      tabs: [
        ...s.tabs,
        makeVirtualTab(id, `${name} Kanban`, "kanban", folderPath),
      ],
      activeTabId: id,
    }));
    later();
  },
  clearRecentFiles() {
    set({ recentFiles: [] });
    later();
  },
  updateBody(id, body) {
    patchTab(id, (t) => ({
      ...t,
      bodyContent: body,
      status: t.status === "conflict" ? "conflict" : "idle",
    }));
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
    if (tab.frontmatter.validationError) {
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
      return {
        tabs,
        activeTabId:
          s.activeTabId === id ? (tabs.at(-1)?.id ?? null) : s.activeTabId,
      };
    });
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
  async change(event) {
    const epoch = sessionEpoch;
    if (event.type === "rename" && event.source) {
      const source = event.source,
        dest = event.path;
      const replace = (p: string) =>
        p === source
          ? dest
          : p.startsWith(source + "/")
            ? dest + p.slice(source.length)
            : p;
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
        tabs: s.tabs.map((t) => ({
          ...t,
          id: replace(t.id),
          name: replace(t.id).split("/").pop()!,
          parentName: replace(t.id).split("/").slice(-2, -1).join(""),
        })),
        activeTabId: s.activeTabId ? replace(s.activeTabId) : null,
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
  async move(source, dest) {
    if (!(await get().saveAll())) return;
    await api("/api/files/path", "PATCH", { source, dest });
    const replace = (p: string) =>
      p === source
        ? dest
        : p.startsWith(source + "/")
          ? dest + p.slice(source.length)
          : p;
    set((s) => ({
      tabs: s.tabs.map((t) => ({
        ...t,
        id: replace(t.id),
        name: replace(t.id).split("/").pop()!,
        parentName: replace(t.id).split("/").slice(-2, -1).join(""),
      })),
      activeTabId: s.activeTabId ? replace(s.activeTabId) : null,
      scrollPositions: Object.fromEntries(
        Object.entries(s.scrollPositions).map(([p, v]) => [replace(p), v]),
      ),
      expanded: s.expanded.map(replace),
      recentFiles: s.recentFiles.map((f) => ({ ...f, path: replace(f.path) })),
    }));
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
    const session: Session = {
      tabs: s.tabs.filter((t) => !isVirtualTabId(t.id)).map((t) => t.id),
      activeTabId:
        s.activeTabId && !isVirtualTabId(s.activeTabId) ? s.activeTabId : null,
      scrollPositions: s.scrollPositions,
      expanded: s.expanded,
      theme: s.theme,
      sidebarWidth: s.sidebarWidth,
    };
    try {
      await Promise.all([
        api("/api/workspace/tabs", "PUT", session, s.workspace),
        api("/api/workspace/recent-files", "PUT", s.recentFiles, s.workspace),
      ]);
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
