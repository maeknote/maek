import { FilePicker } from "./features/editor/components/FilePicker";
import { NotePicker } from "./features/editor/components/note-picker/NotePicker";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FileText,
  FolderOpen,
  X,
  Moon,
  Sun,
  ExternalLink,
  Power,
  RefreshCw,
} from "lucide-react";
import { useStore, schedulePersistence, markTabsDirty, type Tab } from "./store";
import { api, artifactUrl, rawUrl } from "./host";
import { Explorer } from "./features/explorer/Explorer";
import { MarkdownEditor } from "./features/editor/MarkdownEditor";
import { TitleBar } from "./features/editor/components/TitleBar";
import { WorkspaceDashboard } from "./features/editor/components/WorkspaceDashboard";
import { FolderKanbanView } from "./features/database/kanban/FolderKanbanView";
import { ContentSearch } from "./features/search/ContentSearch";
import { navigate, parseRoute, pathForWorkspaceKey, workspaceKeyFor, type Route } from "./lib/routes";
import {
  isTabDirty,
  getTabFileContent,
} from "./features/editor/utils/frontmatter";
import {
  ToastProvider,
  ToastContainer,
  Button,
  PanelIcon,
} from "./shared/components";
import type { FileNode, FileContent } from "@shared/workspace";

function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="glass-modal fixed top-[18vh] left-1/2 -translate-x-1/2 z-50 w-[min(560px,90vw)] p-5 rounded-2xl text-neutral-ink">
          <Dialog.Title className="font-semibold mb-3">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
          <Dialog.Close
            aria-label="Close"
            className="icon-button absolute right-3 top-3"
          >
            <X size={16} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function HtmlArtifactPreview({ tab, nonce }: { tab: Tab; nonce: number }) {
  const fileUrl = artifactUrl(tab.id);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <iframe
        key={`${fileUrl}:${tab.generation}:${nonce}`}
        title={tab.name}
        src={fileUrl}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        className="flex-1 min-h-0 w-full border-0 bg-white"
      />
    </div>
  );
}

function Preview({
  tab,
  htmlPreviewNonce = 0,
}: {
  tab: Tab;
  htmlPreviewNonce?: number;
}) {
  if (tab.file.kind === "image")
    return (
      <div className="flex-1 min-h-0 overflow-auto p-8 flex items-center justify-center">
        <img
          src={rawUrl(tab.id) + "&v=" + tab.generation}
          alt={tab.name}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  if (tab.file.kind === "pdf")
    return (
      <iframe
        title={tab.name}
        src={rawUrl(tab.id)}
        className="flex-1 min-h-0 w-full"
      />
    );
  if (tab.file.kind === "text")
    return (
      <pre className="flex-1 min-h-0 overflow-auto p-8 text-sm whitespace-pre-wrap font-mono">
        {tab.file.content}
      </pre>
    );
  if (tab.file.kind === "html")
    return <HtmlArtifactPreview key={tab.id} tab={tab} nonce={htmlPreviewNonce} />;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-muted-text">
      <FileText size={40} />
      <p>Unsupported file format</p>
      <p className="text-sm">{tab.name}</p>
      <Button
        variant="outline"
        onClick={() =>
          void api("/api/files/open-external", "POST", { path: tab.id }).catch(
            (e) => useStore.getState().setError(String(e)),
          )
        }
      >
        <ExternalLink size={16} />
        Open in default app
      </Button>
    </div>
  );
}
function ReferencePreview({ path }: { path: string }) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let current = true; setFile(null); setError(""); void api<FileContent>("/api/files/content?path=" + encodeURIComponent(path)).then((value) => { if (current) setFile(value); }).catch((value) => { if (current) setError(String(value)); }); return () => { current = false; }; }, [path]);
  if (error) return <div role="alert" className="p-5 text-sm text-maek-red">{error}</div>;
  if (!file) return <div className="p-5 text-sm text-muted-text">Loading reference</div>;
  if (file.kind === "image") return <img src={rawUrl(path)} alt={path} className="max-w-full max-h-full object-contain m-auto"/>;
  if (file.kind === "pdf") return <iframe title={path} src={rawUrl(path)} className="w-full h-full border-0"/>;
  if (file.kind === "html") return <iframe title={path} src={artifactUrl(path)} sandbox="allow-scripts allow-same-origin allow-forms allow-downloads" className="w-full h-full border-0 bg-white"/>;
  return <pre className="p-5 whitespace-pre-wrap text-sm overflow-auto">{file.content}</pre>;
}
function AppContent() {
  const state = useStore();
  const [search, setSearch] = useState(false),
    [settings, setSettings] = useState(false),
    [showQuitConfirm, setShowQuitConfirm] = useState(false),
    [path, setPath] = useState(""),
    [collapsed, setCollapsed] = useState(false),
    [shuttingDown, setShuttingDown] = useState(false);
  const [htmlPreviewNonce, setHtmlPreviewNonce] = useState(0);
  const [route, setRoute] = useState<Route | null>(() => parseRoute());
  const started = useRef(false);
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  useEffect(() => {
    const updateRoute = () => setRoute(parseRoute());
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, []);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const target = route ? pathForWorkspaceKey(route.workspaceKey) : null;
    const last = target ?? localStorage.getItem("maek:workspace") ?? localStorage.getItem("oh-my-maek:workspace");
    if (last) void state.openWorkspace(last);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = state.theme; }, [state.theme]);
  useEffect(() => {
    if (!state.workspace || !state.ready) return;
    const key = workspaceKeyFor(state.workspace.root);
    if (!route || route.workspaceKey !== key) { navigate({ kind: "home", workspaceKey: key }, true); return; }
    if (route.kind === "note" && route.path) void state.openFile(route.path);
    if (route.kind === "folder" && route.view === "board") state.openKanban(route.path);
    if (route.kind === "folder" && route.view === "list") {
      const expanded = route.path.split("/").filter(Boolean).map((_, index, parts) => parts.slice(0, index + 1).join("/"));
      useStore.setState((current) => ({ expanded: [...new Set([...current.expanded, ...expanded])]}));
      state.openDashboard();
    }
    if (route.kind === "home") state.openDashboard();
  }, [state.workspace?.root, state.ready, route?.kind, route?.workspaceKey, route && "path" in route ? route.path : ""]);
  useEffect(() => {
    if (!state.workspace || !state.ready || !route) return;
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    const key = workspaceKeyFor(state.workspace.root);
    if (tab && !tab.id.startsWith("maek:virtual:")) { document.title = `${tab.name} · ${state.workspace.name} · Maek`; if (route.kind !== "note" || route.path !== tab.id) navigate({ kind: "note", workspaceKey: key, path: tab.id }, true); }
    else if (route.kind === "home") document.title = `${state.workspace.name} · Maek`;
  }, [state.activeTabId, state.workspace?.root, state.ready]);
  async function newNote() {
    try {
      const n = await api<FileNode>("/api/files", "POST", {
        dir:
          tab && !tab.id.startsWith("maek:virtual:")
            ? tab.id.split("/").slice(0, -1).join("/")
            : "",
        name: "Untitled.md",
        kind: "file",
      });
      await state.refresh();
      await state.openFile(n.id);
    } catch (e) {
      state.setError(String(e));
    }
  }
  async function quitServer() {
    try {
      await api("/api/app/quit", "POST");
      setShowQuitConfirm(false);
      setSettings(false);
      setShuttingDown(true);
      setTimeout(() => {
        try {
          window.close();
        } catch {
          // Browser may restrict window.close if not opened by script
        }
      }, 500);
    } catch (e) {
      state.setError(String(e));
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "o")) {
        e.preventDefault();
        setSearch(true);
      }
      if (cmd && e.key.toLowerCase() === "n" && state.workspace) {
        e.preventDefault();
        void newNote();
      }
      if (cmd && e.key.toLowerCase() === "w" && tab) {
        e.preventDefault();
        void state.closeTab(tab.id);
      }
      if (cmd && e.key === ",") {
        e.preventDefault();
        setSettings(true);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [state.workspace, tab]);
  async function saveCopy(t: Tab) {
    try {
      const copy = await api<FileNode>("/api/files", "POST", {
        dir: t.id.split("/").slice(0, -1).join("/"),
        name: t.name.replace(/\.md$/i, " copy.md"),
        kind: "file",
      });
      const base = await api<{ hash: string; mtimeMs: number }>(
        "/api/files/content?path=" + encodeURIComponent(copy.id),
      );
      await api("/api/files/content", "PUT", {
        path: copy.id,
        content: getTabFileContent(t),
        baseHash: base.hash,
        baseMtimeMs: base.mtimeMs,
      });
      await state.refresh();
      await state.openFile(copy.id);
    } catch (e) {
      state.setError(String(e));
    }
  }
  const openingMessage = {
    idle: "Choose a folder to open your Markdown notes.",
    selecting: "Waiting for folder selection…",
    opening: "Opening workspace…",
    indexing: `Reading ${state.openingWorkspace?.name ?? "workspace"}…`,
    "restoring-tabs": "Restoring previous tabs…",
  }[state.openingPhase];
  if (shuttingDown)
    return (
      <div className="h-screen flex items-center justify-center bg-warm-vellum">
        <section className="glass-panel rounded-2xl p-8 w-[440px] text-neutral-ink text-center shadow-xl">
          <Power className="w-9 h-9 text-maek-red mx-auto mb-5" />
          <h1 className="text-2xl font-semibold mb-2">Maek stopped</h1>
          <p className="text-sm text-muted-text mb-6">
            You can safely close this browser tab.
          </p>
          <Button variant="outline" onClick={() => window.close()}>
            Close Tab
          </Button>
        </section>
      </div>
    );
  return (
    <>
      {!state.workspace || !state.ready ? (
        <div className="h-screen flex items-center justify-center bg-warm-vellum">
          <section className="glass-panel rounded-2xl p-8 w-[440px] text-neutral-ink">
            <FolderOpen className="w-9 h-9 text-maek-red mb-5" />
            <h1 className="text-2xl font-semibold mb-2">Open your workspace</h1>
            <p className="text-sm text-muted-text mb-6">
              {openingMessage}
            </p>
            <Button
              disabled={state.restoring}
              onClick={() => void state.openWorkspace()}
            >
              {state.openingPhase === "selecting" ? "Selecting…" : "Open Folder"}
            </Button>
            <details className="mt-5 text-sm text-muted-text">
              <summary className="cursor-pointer">Enter folder path</summary>
              <form
                className="flex gap-2 mt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void state.openWorkspace(path);
                }}
              >
                <input
                  className="workspace-input"
                  aria-label="Workspace path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  required
                />
                <Button type="submit" size="sm">
                  Open
                </Button>
              </form>
            </details>
            {state.restoring && (
              <Button
                className="mt-3"
                variant="ghost"
                size="sm"
                onClick={state.cancelWorkspaceOpen}
              >
                Cancel
              </Button>
            )}
            {(state.connectionError || state.error) && (
              <p role="alert" className="mt-4 text-sm text-maek-red">
                {state.connectionError || state.error}
              </p>
            )}
          </section>
        </div>
      ) : (
        <div className="w-screen h-screen overflow-hidden bg-surface pt-[6px] pb-2 pl-2 flex text-neutral-ink">
          {!collapsed && (
            <>
              <aside
                className="glass-panel glass-panel-inner h-full overflow-hidden bg-warm-vellum rounded-2xl border border-default shrink-0"
                style={{ width: state.sidebarWidth }}
              >
                <Explorer
                  onSearch={() => { if (state.workspace) navigate({ kind: "search", workspaceKey: workspaceKeyFor(state.workspace.root), query: "", folder: "", fileKind: "" }); }}
                  onHome={() => { if (state.workspace) navigate({ kind: "home", workspaceKey: workspaceKeyFor(state.workspace.root) }); }}
                  onSettings={() => setSettings(true)}
                  onCollapse={() => setCollapsed(true)}
                  onQuit={() => setShowQuitConfirm(true)}
                />
              </aside>
              <div
                role="separator"
                aria-label="Resize sidebar"
                aria-orientation="vertical"
                className="w-2 cursor-col-resize shrink-0"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    useStore.setState({
                      sidebarWidth: Math.min(600, Math.max(180, e.clientX - 8)),
                    });
                }}
                onPointerUp={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  schedulePersistence();
                }}
              />
            </>
          )}
          {collapsed && (
            <aside
              className="h-full w-10 shrink-0 bg-surface"
              aria-label="Collapsed sidebar"
            >
              <div className="h-[52px] pt-2 pb-1 flex items-center justify-center">
                <button
                  aria-label="Open sidebar"
                  title="Open sidebar"
                  className="sidebar-toggle-button"
                  onClick={() => setCollapsed(false)}
                >
                  <PanelIcon side="left" isExpanded={false} size={15} />
                </button>
              </div>
            </aside>
          )}
          <main className="flex-1 min-w-0 h-full flex flex-col bg-surface overflow-hidden">
            {(state.connectionError || state.error) && (
              <div role="alert" className="notice">
                <span>{state.connectionError || state.error}</span>
                <button
                  onClick={() => state.setError("")}
                  aria-label="Dismiss error"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {route?.kind === "search" ? (
              <ContentSearch route={route} onClose={() => {
                if (state.workspace) navigate({ kind: "home", workspaceKey: workspaceKeyFor(state.workspace.root) });
              }} />
            ) : tab ? (
              tab.viewKind === "workspace-settings" ? (
                <WorkspaceDashboard />
              ) : tab.viewKind === "kanban" ? (
                <FolderKanbanView folderPath={tab.kanbanFolderPath ?? ""} />
              ) : (
                <>
                <TitleBar
                  tab={tab}
                  onRename={(name) =>
                    state.move(
                      tab.id,
                      [...tab.id.split("/").slice(0, -1), name].join("/"),
                    )
                  }
                  actions={
                    tab.viewKind === "editor" ? (
                      <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-text hover:bg-surface-overlay hover:text-neutral-ink" onClick={() => { const reference = window.prompt("Reference file path (PDF, HTML, image, or text)", route?.kind === "note" ? route.compare ?? "" : ""); if (reference && state.workspace) navigate({ kind: "note", workspaceKey: workspaceKeyFor(state.workspace.root), path: tab.id, compare: reference }); }}>Compare reference</button>
                    ) : tab.file.kind === "html" ? (
                      <div className="flex items-center gap-1 shrink-0 text-sm">
                        <button
                          type="button"
                          onClick={() =>
                            setHtmlPreviewNonce((value) => value + 1)
                          }
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-text hover:bg-surface-overlay hover:text-neutral-ink"
                          aria-label="Reload HTML preview"
                        >
                          <RefreshCw size={14} />
                          Reload
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              artifactUrl(tab.id),
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-text hover:bg-surface-overlay hover:text-neutral-ink"
                        >
                          <ExternalLink size={14} />
                          Open in browser
                        </button>
                      </div>
                    ) : undefined
                  }
                />
                {tab.status === "conflict" || tab.status === "error" ? (
                  <div role="alert" className="notice">
                    <span>{tab.error}</span>
                    <button
                      onClick={() => {
                        if (
                          !isTabDirty(tab) ||
                          window.confirm(
                            "Discard local edits and reload from disk?",
                          )
                        )
                          void state.reload(tab.id);
                      }}
                    >
                      Reload
                    </button>
                    <button onClick={() => void saveCopy(tab)}>
                      Save a copy
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm("Discard local edits and close?")) {
                          useStore.setState((s) => ({
                            tabs: s.tabs.filter((t) => t.id !== tab.id),
                            activeTabId:
                              s.tabs.find((t) => t.id !== tab.id)?.id ?? null,
                          }));
                          markTabsDirty();
                          schedulePersistence();
                        }
                      }}
                    >
                      Close
                    </button>
                  </div>
                ) : null}
                {tab.viewKind === "editor" ? (
                  route?.kind === "note" && route.compare ? (
                    <div className="flex-1 min-h-0 flex overflow-hidden">
                      <div className="flex-1 min-w-0 border-r border-default"><MarkdownEditor key={tab.id + ":" + tab.generation} tab={tab} /></div>
                      <aside className="flex-1 min-w-0 overflow-auto bg-warm-vellum/30"><div className="px-4 py-2 text-xs text-muted-text border-b border-default">Reference: {route.compare}</div><ReferencePreview path={route.compare} /></aside>
                    </div>
                  ) : <MarkdownEditor key={tab.id + ":" + tab.generation} tab={tab} />
                ) : (
                  <Preview tab={tab} htmlPreviewNonce={htmlPreviewNonce} />
                )}
              </>
              )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-text gap-3">
                <FileText size={36} strokeWidth={1} />
                <p className="text-sm">Select a note to start writing</p>
                <button
                  className="text-sm text-maek-red"
                  onClick={() => void newNote()}
                >
                  Create a note
                </button>
                <span className="text-xs">⌘P Open file · ⌘N New note</span>
              </div>
            )}
          </main>
        </div>
      )}
      {search && <FilePicker onClose={() => setSearch(false)} />}
      <NotePicker />
      <Modal
        title="Workspace settings"
        open={settings}
        onClose={() => setSettings(false)}
      >
        <p className="text-sm text-muted-text break-all mb-4">
          {state.workspace?.root}
        </p>
        <Button variant="outline" onClick={() => void state.openWorkspace()}>
          Open another folder
        </Button>
        <Button
          className="ml-2"
          variant="ghost"
          onClick={() => {
            state.openDashboard();
            setSettings(false);
          }}
        >
          Open dashboard
        </Button>
        <div className="flex items-center gap-3 mt-5 text-sm">
          <span>Appearance</span>
          <Button
            variant="ghost"
            onClick={() => {
              useStore.setState({
                theme: state.theme === "dark" ? "light" : "dark",
              });
              schedulePersistence();
            }}
          >
            {state.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}{" "}
            {state.theme === "dark" ? "Light" : "Dark"}
          </Button>
        </div>
        <p className="text-xs text-muted-text mt-6 pt-4 border-t border-border-gray">
          ⌘P Search · ⌘N New note · ⌘S Save · ⌘W Close tab
        </p>
      </Modal>
      <Modal
        title="Stop Maek?"
        open={showQuitConfirm}
        onClose={() => setShowQuitConfirm(false)}
      >
        <div className="text-center py-2">
          <div className="mx-auto bg-red-50 dark:bg-red-950/30 w-12 h-12 rounded-full flex items-center justify-center mb-4 text-maek-red">
            <Power size={24} />
          </div>
          <p className="text-sm text-muted-text mb-6">
            The local server will shut down. You can start it again from your Desktop icon.
          </p>
          <div className="flex gap-3 justify-center">
            <Button
              variant="outline"
              onClick={() => setShowQuitConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-maek-red text-white hover:bg-maek-red/90 border-0"
              onClick={() => void quitServer()}
            >
              Stop Server
            </Button>
          </div>
        </div>
      </Modal>
      <ToastContainer />
    </>
  );
}
export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
