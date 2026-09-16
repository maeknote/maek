import { FilePicker } from "./features/editor/components/FilePicker";
import { NotePicker } from "./features/editor/components/note-picker/NotePicker";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FileText,
  FolderOpen,
  X,
  Moon,
  Sun,
  ExternalLink,
  Power,
  Plus,
  RefreshCw,
  Search,
  Columns2,
} from "lucide-react";
import { useStore, schedulePersistence, type Tab } from "./store";
import { api, artifactUrl, rawUrl } from "./host";
import { Explorer } from "./features/explorer/Explorer";
import { MarkdownEditor } from "./features/editor/MarkdownEditor";
import { TitleBar } from "./features/editor/components/TitleBar";
import { WorkspaceDashboard } from "./features/editor/components/WorkspaceDashboard";
import { FolderKanbanView } from "./features/database/kanban/FolderKanbanView";
import { DatabaseView } from "./features/database/DatabaseView";
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
import type { FileNode } from "@shared/workspace";

const SpreadsheetEditor = lazy(
  () => import("./features/spreadsheet/SpreadsheetEditor"),
);

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
function SidePane({ tab, onSinglePane }: { tab: Tab; onSinglePane: () => void }) {
  const state = useStore();
  return <div className="flex-1 min-w-0 min-h-0 flex flex-col" onPointerDown={() => state.setSplitActive("right")}>
    <TitleBar tab={tab} onRename={(name) => state.move(tab.id, [...tab.id.split("/").slice(0, -1), name].join("/"))} actions={<button type="button" onClick={onSinglePane} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-text hover:bg-surface-overlay hover:text-neutral-ink" title="Single Pane"><Columns2 size={14}/>Single Pane</button>} />
    {tab.viewKind === "editor" ? <MarkdownEditor key={tab.id + ":" + tab.generation} tab={tab} /> : tab.viewKind === "spreadsheet" ? <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-text">Loading spreadsheet…</div>}><SpreadsheetEditor key={tab.id + ":" + tab.generation} tab={tab} /></Suspense> : <Preview tab={tab} />}
  </div>;
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
  const [sidePicker, setSidePicker] = useState(false);
  const [route, setRoute] = useState<Route | null>(() => parseRoute());
  const started = useRef(false);
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
  const tab = state.split.left && state.split.right
    ? state.tabs.find((t) => t.id === state.split.left) ?? activeTab
    : activeTab;
  const sideTab = state.split.left && state.split.right ? state.tabs.find((t) => t.id === state.split.right) ?? null : null;
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
    if (route.kind === "folder" && route.view !== "list") {
      void api<import("@shared/database").DatabaseMeta[]>("/api/databases").then((databases) => {
        const database = databases.find((item) => item.folderPath === route.path);
        if (database) state.openDatabase(database.folderPath, database.name);
        else state.openKanban(route.path);
      });
    }
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
        name: t.name.replace(/(\.md|\.csv)$/i, " copy$1"),
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
        <div className="w-screen h-screen overflow-hidden bg-surface flex text-neutral-ink">
          {!collapsed && (
              <aside
                className="relative h-full overflow-hidden bg-warm-vellum shrink-0"
                style={{ width: state.sidebarWidth }}
              >
                <Explorer
                  onSearch={() => setSearch(true)}
                  onSettings={() => setSettings(true)}
                  onCollapse={() => setCollapsed(true)}
                  onQuit={() => setShowQuitConfirm(true)}
                />
                <div
                  role="separator"
                  aria-label="Resize sidebar"
                  aria-orientation="vertical"
                  className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      useStore.setState({
                        sidebarWidth: Math.min(600, Math.max(180, e.clientX)),
                      });
                  }}
                  onPointerUp={(e) => {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    schedulePersistence();
                  }}
                />
              </aside>
          )}
          {collapsed && (
            <aside
              className="h-full w-10 shrink-0 bg-warm-vellum"
              aria-label="Collapsed sidebar"
            >
              <nav
                className="pt-2 flex flex-col items-center gap-1"
                aria-label="Sidebar shortcuts"
              >
                <button
                  aria-label="Open sidebar"
                  title="Open sidebar"
                  className="sidebar-toggle-button"
                  onClick={() => setCollapsed(false)}
                >
                  <PanelIcon side="left" isExpanded={false} size={15} />
                </button>
                <div className="my-1 w-5 border-t border-default" />
                <button
                  aria-label="Search"
                  title="Search"
                  className="icon-button"
                  onClick={() => setSearch(true)}
                >
                  <Search size={16} />
                </button>
                <button
                  aria-label="Add new"
                  title="Add new"
                  className="icon-button"
                  onClick={() => setCollapsed(false)}
                >
                  <Plus size={17} />
                </button>
                <div className="my-1 w-5 border-t border-default" />
                <button
                  aria-label="Open tabs"
                  title="Open tabs"
                  className="icon-button"
                  onClick={() => setCollapsed(false)}
                >
                  <Columns2 size={16} />
                </button>
                <button
                  aria-label="Files"
                  title="Files"
                  className="icon-button"
                  onClick={() => setCollapsed(false)}
                >
                  <FolderOpen size={16} />
                </button>
              </nav>
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
            {tab ? (
              tab.viewKind === "workspace-settings" ? (
                <WorkspaceDashboard
                  onNewNote={() => void newNote()}
                  onOpenNote={() => setSearch(true)}
                />
              ) : tab.viewKind === "kanban" ? (
                <FolderKanbanView folderPath={tab.kanbanFolderPath ?? ""} />
              ) : tab.viewKind === "database" ? (
                <DatabaseView folderPath={tab.databaseFolderPath ?? ""} />
              ) : (
                <div className="flex-1 min-h-0 flex overflow-hidden">
                <div className="flex-1 min-w-0 min-h-0 flex flex-col" onPointerDown={() => state.setSplitActive("left")}>
                <TitleBar
                  tab={tab}
                  onRename={(name) =>
                    state.move(
                      tab.id,
                      [...tab.id.split("/").slice(0, -1), name].join("/"),
                    )
                  }
                  actions={
                    <div className="flex items-center gap-1 shrink-0 text-sm">
                      <button type="button" onClick={() => setSidePicker(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-text hover:bg-surface-overlay hover:text-neutral-ink" title="Open File to the Side…"><Columns2 size={14} />Open to the Side</button>
                    {tab.file.kind === "html" ? (
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
                    ) : null}
                    {sideTab ? <button type="button" onClick={() => state.singlePane("left")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-text hover:bg-surface-overlay hover:text-neutral-ink" title="Single Pane"><Columns2 size={14} />Single Pane</button> : null}
                    </div>
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
                          void state.closeTab(tab.id);
                        }
                      }}
                    >
                      Close
                    </button>
                  </div>
                ) : null}
                {tab.viewKind === "editor" ? (
                  <MarkdownEditor key={tab.id + ":" + tab.generation} tab={tab} />
                ) : tab.viewKind === "spreadsheet" ? (
                  <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-text">Loading spreadsheet…</div>}>
                    <SpreadsheetEditor key={tab.id + ":" + tab.generation} tab={tab} />
                  </Suspense>
                ) : (
                  <Preview tab={tab} htmlPreviewNonce={htmlPreviewNonce} />
                )}
                </div>
                {sideTab ? <><div role="separator" aria-label="Resize panes" aria-orientation="vertical" tabIndex={0} className="w-2 shrink-0 cursor-col-resize border-l border-default" onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) state.setSplitRatio((e.clientX - e.currentTarget.parentElement!.getBoundingClientRect().left) / e.currentTarget.parentElement!.getBoundingClientRect().width); }} onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); schedulePersistence(); }} onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); state.setSplitRatio(state.split.ratio + (e.key === "ArrowLeft" ? -.02 : .02)); } }} /><SidePane tab={sideTab} onSinglePane={() => state.singlePane("right")} /></> : null}
                </div>
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
      {sidePicker && <FilePicker onClose={() => setSidePicker(false)} onSelect={async (file) => { await state.openFileToSide(file.id); setSidePicker(false); }} />}
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
          Go to home
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
