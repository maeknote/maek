import { FilePicker } from "./features/editor/components/FilePicker";
import { NotePicker } from "./features/editor/components/note-picker/NotePicker";
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  FileText,
  FolderOpen,
  Plus,
  X,
  Moon,
  Sun,
  ExternalLink,
} from "lucide-react";
import { useStore, schedulePersistence, type Tab } from "./store";
import { api, rawUrl } from "./host";
import { Explorer } from "./features/explorer/Explorer";
import { MarkdownEditor } from "./features/editor/MarkdownEditor";
import { TitleBar } from "./features/editor/components/TitleBar";
import { FrontmatterPanel } from "./features/editor/components/FrontmatterPanel";
import {
  isTabDirty,
  getTabFileContent,
} from "./features/editor/utils/frontmatter";
import {
  ToastProvider,
  ToastContainer,
  Button,
  FloatingMenu,
  MenuItem,
  PanelIcon,
} from "./shared/components";
import { useHoverMenu } from "./shared/hooks";
import { cn } from "./lib/utils";
import type { FileNode } from "@shared/workspace";

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
function Preview({ tab }: { tab: Tab }) {
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
function AppContent() {
  const state = useStore();
  const [search, setSearch] = useState(false),
    [settings, setSettings] = useState(false),
    [path, setPath] = useState(""),
    [collapsed, setCollapsed] = useState(false);
  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const tabHoverMenu = useHoverMenu();
  const tabPlusRef = useRef<HTMLButtonElement>(null);
  const started = useRef(false),
    dragged = useRef<string | null>(null);
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const last = localStorage.getItem("oh-my-maek:workspace");
    if (last) void state.openWorkspace(last);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);
  async function newNote() {
    try {
      const n = await api<FileNode>("/api/files", "POST", {
        dir: tab?.id.split("/").slice(0, -1).join("/") ?? "",
        name: "Untitled.md",
        kind: "file",
      });
      await state.refresh();
      await state.openFile(n.id);
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
  return (
    <>
      {!state.workspace || !state.ready ? (
        <div className="h-screen flex items-center justify-center bg-warm-vellum">
          <section className="glass-panel rounded-2xl p-8 w-[440px] text-neutral-ink">
            <FolderOpen className="w-9 h-9 text-maek-red mb-5" />
            <h1 className="text-2xl font-semibold mb-2">Open your workspace</h1>
            <p className="text-sm text-muted-text mb-6">
              Choose a folder to open your Markdown notes.
            </p>
            <Button
              disabled={state.restoring}
              onClick={() => void state.openWorkspace()}
            >
              {state.restoring ? "Opening…" : "Open Folder"}
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
            {state.error && (
              <p role="alert" className="mt-4 text-sm text-maek-red">
                {state.error}
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
                  onSearch={() => setSearch(true)}
                  onSettings={() => setSettings(true)}
                  onCollapse={() => setCollapsed(true)}
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
          <main className="flex-1 min-w-0 h-full flex flex-col bg-surface overflow-hidden">
            <div className="h-[38px] flex items-end border-b border-border-gray shrink-0 px-2 gap-0.5">
              {collapsed && (
                <button
                  aria-label="Open sidebar"
                  className="icon-button self-center"
                  onClick={() => setCollapsed(false)}
                >
                  <PanelIcon side="left" isExpanded={false} size={16} />
                </button>
              )}
              <div
                className="flex-1 min-w-0 flex overflow-x-auto items-end"
                role="tablist"
              >
                {state.tabs.map((t) => (
                  <div
                    key={t.id}
                    role="tab"
                    aria-selected={t.id === tab?.id}
                    data-tab-id={t.id}
                    tabIndex={0}
                    draggable
                    onDragStart={() => {
                      dragged.current = t.id;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragged.current;
                      if (!from || from === t.id) return;
                      const items = [...state.tabs];
                      const moving = items.find((x) => x.id === from)!;
                      items.splice(items.indexOf(moving), 1);
                      items.splice(
                        items.findIndex((x) => x.id === t.id),
                        0,
                        moving,
                      );
                      useStore.setState({ tabs: items });
                      schedulePersistence();
                    }}
                    onClick={() => state.setActiveTab(t.id)}
                    onAuxClick={(e) => {
                      if (e.button === 1) void state.closeTab(t.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTabMenu({ x: e.clientX, y: e.clientY, id: t.id });
                    }}
                    className={cn(
                      "group relative flex items-center gap-1.5 px-3 h-[34px] cursor-default select-none shrink-0 transition-colors duration-150 focus:outline-none",
                      t.id === tab?.id
                        ? "bg-surface rounded-t-md border-t border-x border-border-gray text-text-main z-10"
                        : "text-muted-text hover:text-text-main hover:bg-surface-overlay rounded-t-sm",
                    )}
                  >
                    <span className="text-xs font-medium whitespace-nowrap">
                      {t.name.replace(/\.md$/i, "")}
                    </span>
                    {state.tabs.some(
                      (other) => other.id !== t.id && other.name === t.name,
                    ) && (
                      <span className="text-[10px] text-muted-text">
                        {t.parentName}
                      </span>
                    )}
                    {isTabDirty(t) && (
                      <span className="text-muted-text" aria-label="Unsaved">
                        •
                      </span>
                    )}
                    <button
                      aria-label={"Close " + t.name}
                      className="w-4 h-4 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-overlay-strong"
                      onClick={(e) => {
                        e.stopPropagation();
                        void state.closeTab(t.id);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  ref={tabPlusRef}
                  aria-label="New note"
                  className="icon-button self-center shrink-0 ml-0.5"
                  onClick={() => {
                    tabHoverMenu.close();
                    void newNote();
                  }}
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    tabHoverMenu.open({ x: r.left, y: r.bottom });
                  }}
                  onMouseLeave={() => {
                    tabHoverMenu.startCloseTimer();
                  }}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            {state.error && (
              <div role="alert" className="notice">
                <span>{state.error}</span>
                <button
                  onClick={() => state.setError("")}
                  aria-label="Dismiss error"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {tab ? (
              <>
                <div className="px-8 pt-3 flex items-center gap-1 text-xs text-muted-text">
                  {tab.id.split("/").map((part, i, parts) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      {i > 0 && <span>/</span>}
                      <button
                        onClick={() => {
                          const p = parts.slice(0, i + 1).join("/");
                          if (i < parts.length - 1) {
                            useStore.setState((s) => ({
                              expanded: [...new Set([...s.expanded, p])],
                            }));
                            window.dispatchEvent(
                              new CustomEvent("focus-folder", { detail: p }),
                            );
                            schedulePersistence();
                          }
                        }}
                      >
                        {part}
                      </button>
                    </span>
                  ))}
                  <span className="ml-auto" role="status">
                    {tab.status === "saving"
                      ? "Saving…"
                      : tab.status === "saved"
                        ? "Saved"
                        : ""}
                  </span>
                </div>
                <TitleBar
                  tab={tab}
                  onRename={(name) =>
                    state.move(
                      tab.id,
                      [...tab.id.split("/").slice(0, -1), name].join("/"),
                    )
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
                          schedulePersistence();
                        }
                      }}
                    >
                      Close
                    </button>
                  </div>
                ) : null}
                {tab.viewKind === "editor" ? (
                  <>
                    <FrontmatterPanel
                      tab={tab}
                      onSave={() => void state.save(tab.id)}
                    />
                    <MarkdownEditor
                      key={tab.id + ":" + tab.generation}
                      tab={tab}
                    />
                  </>
                ) : (
                  <Preview tab={tab} />
                )}
              </>
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
        <p className="text-xs text-muted-text mt-4">
          ⌘P Search · ⌘N New note · ⌘S Save · ⌘W Close tab
        </p>
      </Modal>
      {tabMenu && (
        <FloatingMenu
          isOpen
          position={tabMenu}
          onClose={() => setTabMenu(null)}
        >
          <MenuItem
            label="Close tab"
            onClick={() => {
              void state.closeTab(tabMenu.id);
              setTabMenu(null);
            }}
          />
          <MenuItem
            label="Close other tabs"
            onClick={() => {
              for (const t of state.tabs)
                if (t.id !== tabMenu.id) void state.closeTab(t.id);
              setTabMenu(null);
            }}
          />
          <MenuItem
            label="Close all tabs"
            onClick={() => {
              for (const t of state.tabs) void state.closeTab(t.id);
              setTabMenu(null);
            }}
          />
        </FloatingMenu>
      )}
      {tabHoverMenu.isOpen && (
        <FloatingMenu
          isOpen
          position={tabHoverMenu.position}
          anchorRef={tabPlusRef}
          onClose={() => tabHoverMenu.close()}
          onMouseEnter={tabHoverMenu.cancelCloseTimer}
          onMouseLeave={tabHoverMenu.startCloseTimer}
        >
          <MenuItem
            icon={<FileText size={16} />}
            label="New note"
            shortcut="⌘N"
            onClick={() => {
              tabHoverMenu.close();
              void newNote();
            }}
          />
          <MenuItem
            icon={<FolderOpen size={16} />}
            label="Open existing note"
            shortcut="⌘P"
            onClick={() => {
              tabHoverMenu.close();
              setSearch(true);
            }}
          />
        </FloatingMenu>
      )}
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
