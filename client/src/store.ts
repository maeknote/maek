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
  ready: boolean;
  restoring: boolean;
  scrollPositions: Record<string, number>;
  expanded: string[];
  theme: "light" | "dark";
  sidebarWidth: number;
  recentFiles: { path: string; lastOpened: number }[];
  openWorkspace: (path?: string) => Promise<void>;
  refresh: () => Promise<void>;
  openFile: (id: string) => Promise<void>;
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
function later() {
  clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => void useStore.getState().persist(), 300);
}
const patchTab = (id: string, fn: (t: Tab) => Tab) =>
  useStore.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)),
  }));
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
export const useStore = create<State>((set, get) => ({
  workspaces: [],
  workspace: null,
  nodes: [],
  tabs: [],
  activeTabId: null,
  error: "",
  ready: false,
  restoring: false,
  scrollPositions: {},
  expanded: [],
  theme: "light",
  sidebarWidth: 260,
  recentFiles: [],
  setError: (message) => set({ error: message }),
  async openWorkspace(path) {
    if (get().restoring) return;
    set({ restoring: true, error: "" });
    try {
      if (!(await get().saveAll())) return;
      const ws = path
        ? await api<WorkspaceRef>("/api/workspaces/open", "POST", { path })
        : await api<{
            status: string;
            workspace?: WorkspaceRef;
            reason?: string;
          }>("/api/workspaces/pick", "POST").then((r) => {
            if (r.status === "canceled") return null;
            if (!r.workspace)
              throw new Error(
                r.reason ??
                  "Folder picker is unavailable. Enter the path below.",
              );
            return r.workspace;
          });
      if (!ws) return;
      await get().persist();
      events?.close();
      sessionEpoch++;
      setHostWorkspace(ws);
      set({
        workspace: ws,
        tabs: [],
        nodes: [],
        activeTabId: null,
        ready: false,
      });
      const [tree, session, recents, storedWorkspaces] = await Promise.all([
        api<{ nodes: FileNode[]; warnings: string[] }>("/api/tree"),
        api<Session>("/api/workspace/tabs"),
        api<{ path: string; lastOpened: number }[]>(
          "/api/workspace/recent-files",
        ),
        api<{ id: string; name: string; path: string }[]>(
          "/api/workspace/workspaces",
        ),
      ]);
      const tabs: Tab[] = [];
      for (const id of session.tabs) {
        try {
          tabs.push(
            makeTab(
              id,
              await api<FileContent>(
                "/api/files/content?path=" + encodeURIComponent(id),
              ),
            ),
          );
        } catch {
          /* Missing files do not resurrect. */
        }
      }
      set({
        nodes: tree.nodes,
        workspaces: [
          ...new Map(
            [
              { id: ws.wsId, name: ws.name, path: ws.root },
              ...get().workspaces,
              ...storedWorkspaces,
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
        error: tree.warnings.length
          ? `Cannot read: ${tree.warnings.join(", ")}`
          : "",
      });
      localStorage.setItem("oh-my-maek:workspace", ws.root);
      later();
      document.documentElement.dataset.theme = session.theme;
      events = new EventSource(
        "/api/workspaces/events?workspace=" + encodeURIComponent(ws.wsId),
      );
      events.addEventListener(
        "change",
        (e) =>
          void get().change(JSON.parse((e as MessageEvent).data) as Change),
      );
      events.addEventListener("rescan", () => void get().refresh());
      events.addEventListener("watch-error", () =>
        set({ error: "File watching stopped. Reconnecting…" }),
      );
      events.onerror = () =>
        set({ error: "Connection interrupted. Reconnecting…" });
      events.onopen = () => set({ error: "" });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ restoring: false });
    }
  },
  async refresh() {
    try {
      const epoch = sessionEpoch;
      const tree = await api<{ nodes: FileNode[]; warnings: string[] }>(
        "/api/tree",
      );
      if (epoch !== sessionEpoch) return;
      set({
        nodes: tree.nodes,
        error: tree.warnings.length
          ? `Cannot read: ${tree.warnings.join(", ")}`
          : "",
      });
      for (const t of get().tabs)
        await get().change({
          type: tree.nodes.some((n) => n.id === t.id) ? "change" : "unlink",
          path: t.id,
        });
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
      const file = await api<FileContent>(
        "/api/files/content?path=" + encodeURIComponent(id),
      );
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
      const file = await api<FileContent>(
        "/api/files/content?path=" + encodeURIComponent(id),
      );
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
        const file = await api<FileContent>(
          "/api/files/content?path=" + encodeURIComponent(tab.id),
        );
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
      tabs: s.tabs.map((t) => t.id),
      activeTabId: s.activeTabId,
      scrollPositions: s.scrollPositions,
      expanded: s.expanded,
      theme: s.theme,
      sidebarWidth: s.sidebarWidth,
    };
    try {
      await Promise.all([
        api("/api/workspace/tabs", "PUT", session, s.workspace),
        api("/api/workspace/recent-files", "PUT", s.recentFiles, s.workspace),
        api("/api/workspace/workspaces", "PUT", s.workspaces, s.workspace),
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
