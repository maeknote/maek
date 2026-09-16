import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Tree, type TreeApi, type NodeRendererProps } from "react-arborist";
import {
  ChevronRight,
  File,
  FileCode,
  FileText,
  FolderPlus,
  Plus,
  Power,
  RefreshCw,
  Search,
  Table,
  Settings,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { FolderSelector } from "./components/FolderSelector";
import {
  FloatingMenu,
  ConfirmDialog,
  MenuItem,
  MenuSeparator,
  PanelIcon,
} from "../../shared/components";
import { useHoverMenu } from "../../shared/hooks";
import { useStore, schedulePersistence } from "../../store";
import { api, toBase64 } from "../../host";
import type { FileNode } from "@shared/workspace";
import type { DatabaseMeta } from "@shared/database";
import { cn } from "../../lib/utils";
import { collectDropFiles } from "./importDrop";
import { useFolderAppearance } from "./stores/folderAppearanceStore";
import { FolderCustomizeSubmenu } from "./components/FolderCustomizeSubmenu";
import { FOLDER_ICON_MAP, getFolderIconColorValue } from "./utils/folderAppearance";
import { isTabDirty } from "../editor/utils/frontmatter";

interface Props {
  onSearch: () => void;
  onSettings: () => void;
  onCollapse: () => void;
  onQuit: () => void;
}
export function Explorer({ onSearch, onSettings, onCollapse, onQuit }: Props) {
  const {
    nodes,
    workspace,
    restoring,
    expanded,
    workspaces,
    tabs,
    activeTabId,
  } = useStore();
  const container = useRef<HTMLDivElement>(null),
    tree = useRef<TreeApi<FileNode>>(null);
  const dragPreviewRef = useRef<HTMLDivElement>(null);
  const dragPreviewTextRef = useRef<HTMLSpanElement>(null);
  const dragTab = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const suppressTabClick = useRef(false);
  const [pendingReveal, setPendingReveal] = useState<{ id: string } | null>(null);
  const saveStatus = tabs.some((tab) => tab.status === "saving")
    ? "Saving"
    : tabs.some(isTabDirty) ? "Unsaved" : null;
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [pendingTrash, setPendingTrash] = useState<{
    paths: string[];
    label: string;
  } | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  const [openNotesMenu, setOpenNotesMenu] = useState<{
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const { appearances, load } = useFolderAppearance();


  const updateDropIndex = useCallback((index: number | null) => {
    dropIndexRef.current = index;
    setDropIndex(index);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragTab.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.dragging) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5)
          return;
        drag.dragging = true;
        suppressTabClick.current = true;
        
        const tab = useStore.getState().tabs.find((t) => t.id === drag.id);
        if (tab && dragPreviewTextRef.current) {
          dragPreviewTextRef.current.textContent = tab.name;
        }
      }
      
      if (dragPreviewRef.current) {
        dragPreviewRef.current.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 10}px)`;
        dragPreviewRef.current.style.display = "flex";
      }

      event.preventDefault();
      const row = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-tab-id]");
      if (!row) {
        // If moved outside tabs area, we can still show preview, but maybe clear drop index
        return;
      }
      const currentTabs = useStore.getState().tabs;
      const index = currentTabs.findIndex((tab) => tab.id === row.dataset.tabId);
      if (index < 0) return;
      const rect = row.getBoundingClientRect();
      updateDropIndex(event.clientY - rect.top > rect.height / 2 ? index + 1 : index);
    };
    const finishPointerDrag = (event: PointerEvent) => {
      const drag = dragTab.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragTab.current = null;
      if (dragPreviewRef.current) {
        dragPreviewRef.current.style.display = "none";
      }
      if (drag.dragging && dropIndexRef.current !== null) {
        const from = useStore.getState().tabs.findIndex((tab) => tab.id === drag.id);
        useStore.getState().reorderTabs(from, dropIndexRef.current);
      }
      updateDropIndex(null);
      // A normal pointerup emits click next; let that click consume the flag.
      // Clear it afterward as a fallback for pointercancel or browser quirks.
      window.setTimeout(() => {
        suppressTabClick.current = false;
      }, 0);
    };
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", finishPointerDrag);
    document.addEventListener("pointercancel", finishPointerDrag);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", finishPointerDrag);
      document.removeEventListener("pointercancel", finishPointerDrag);
    };
  }, [updateDropIndex]);

  useEffect(() => {
    if (workspace?.wsId) {
      void load();
    }
  }, [workspace?.wsId, load]);

  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    node: FileNode | null;
  } | null>(null);
  const createHoverMenu = useHoverMenu();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [clipboard, setClipboard] = useState<string[]>([]);
  const [selection, setSelection] = useState<FileNode[]>([]);
  const [pendingEdit, setPendingEdit] = useState<string | null>(null);
  const [browseFolders,setBrowseFolders]=useState<string[]>([]);
  const [databases, setDatabases] = useState<DatabaseMeta[]>([]);
  useEffect(() => {
    if (!workspace) { setDatabases([]); return; }
    let cancelled=false;
    const refresh=()=>void api<DatabaseMeta[]>('/api/databases').then(d=>{if(!cancelled)setDatabases(d)}).catch(()=>{});
    refresh();window.addEventListener('maek:workspace-change',refresh);
    return()=>{cancelled=true;window.removeEventListener('maek:workspace-change',refresh)};
  }, [workspace?.wsId]);
  const data = useMemo(() => {
    const map = new Map(
      nodes.map((n) => [
        n.id,
        { ...n, ...(n.isDir ? { children: [] as FileNode[] } : {}) },
      ]),
    );
    const roots: FileNode[] = [];
    for (const n of map.values()) {
      if (n.parent) map.get(n.parent)?.children?.push(n);
      else roots.push(n);
    }
    return roots;
  }, [nodes]);
  const visibleNodeCount = useMemo(() => {
    const expandedIds = new Set(expanded);
    const countVisible = (items: FileNode[]): number =>
      items.reduce(
        (count, item) =>
          count +
          1 +
          (item.isDir && expandedIds.has(item.id)
            ? countVisible(item.children ?? [])
            : 0),
        0,
      );
    return countVisible(data);
  }, [data, expanded]);

  const revealInFolderTree = useCallback(
    (id: string) => {
      if (!nodes.some((node) => node.id === id)) {
        useStore.getState().setError("This file is no longer in the folder tree.");
        return;
      }
      setPendingReveal({ id });
    },
    [nodes],
  );
  useEffect(() => {
    const api = tree.current;
    if (!pendingReveal || !api) return;
    let cancelled = false;
    const { id } = pendingReveal;
    // get(id) only sees expanded nodes. scrollTo opens ancestors using the
    // complete tree, then waits for the visible-node index to be rebuilt.
    void (async () => {
      await api.scrollTo(id, "center");
      if (cancelled) return;
      if (api.get(id)) {
        api.select(id, { align: "center" });
        container.current?.querySelector<HTMLElement>('[role="tree"]')?.focus();
      } else {
        useStore.getState().setError("Could not reveal this file in the folder tree.");
      }
      setPendingReveal(null);
    })();
    return () => { cancelled = true; };
  }, [pendingReveal, workspace?.wsId]);
  useEffect(() => {
    if (pendingEdit && tree.current?.get(pendingEdit)) {
      const n = tree.current.get(pendingEdit)!;
      n.openParents();
      void n.edit();
      setPendingEdit(null);
    }
  }, [nodes, pendingEdit]);
  const run = async (fn: () => Promise<unknown>) => {
    setMenu(null);
    try {
      await fn();
    } catch (e) {
      useStore.getState().setError(String(e));
    }
  };
  const currentDir = (n = menu?.node ?? selection[0]) =>
    n ? (n.isDir ? n.id : (n.parent ?? "")) : "";
  async function createDatabase(dir = currentDir()) {
    const name = window.prompt("Database name", "New Database")?.trim();
    if (!name) return;
    const database = await api<DatabaseMeta>("/api/databases", "POST", { parent: dir, name, viewType: "table" });
    await useStore.getState().refresh();
    setDatabases(await api<DatabaseMeta[]>("/api/databases"));
    useStore.getState().openDatabase(database.folderPath, database.name);
  }
  async function create(kind: "file" | "dir", dir = currentDir(), name?: string) {
    const node = await api<FileNode>("/api/files", "POST", {
      dir,
      name: name ?? (kind === "file" ? "Untitled.md" : "New Folder"),
      kind,
    });
    await useStore.getState().refresh();
    if (kind === "file") await useStore.getState().openFile(node.id);
    setPendingEdit(node.id);
  }
  async function paste(dir = currentDir()) {
    if (!clipboard.length) return;
    await api("/api/files/copy", "POST", { dir, paths: clipboard });
    await useStore.getState().refresh();
  }
  async function trash(paths: string[]) {
    const affectedTabs = useStore
      .getState()
      .tabs.filter((tab) =>
        paths.some((p) => tab.id === p || tab.id.startsWith(p + "/")),
      );
    const saved = await Promise.all(
      affectedTabs.map((tab) => useStore.getState().save(tab.id)),
    );
    if (!saved.every(Boolean))
      throw new Error("Could not save an open file before moving it to Trash.");

    await api("/api/files", "DELETE", { paths });
    for (const tab of affectedTabs) await useStore.getState().closeTab(tab.id);
    await useStore.getState().refresh();
  }
  function requestTrash(paths: string[]) {
    const uniquePaths = [...new Set(paths)].filter(Boolean);
    if (!uniquePaths.length) return;
    const label =
      uniquePaths.length === 1
        ? (nodes.find((node) => node.id === uniquePaths[0])?.name ??
          uniquePaths[0]!.split("/").at(-1) ??
          uniquePaths[0]!)
        : `${uniquePaths.length} items`;
    setMenu(null);
    setPendingTrash({ paths: uniquePaths, label });
  }
  async function confirmTrash() {
    if (!pendingTrash || trashBusy) return;
    setTrashBusy(true);
    try {
      await trash(pendingTrash.paths);
      setPendingTrash(null);
    } catch (error) {
      useStore.getState().setError(String(error));
    } finally {
      setTrashBusy(false);
    }
  }
  const contextPaths = () =>
    menu?.node
      ? selection.some((n) => n.id === menu.node?.id)
        ? selection.map((n) => n.id)
        : [menu.node.id]
      : selection.map((n) => n.id);
  const Node = useCallback(
    ({ node, style, dragHandle }: NodeRendererProps<FileNode>) => {
      // Strip react-arborist's auto-injected paddingLeft so the depth guide
      // spans are the single source of indent (matches maeknote-app design).
      const computedStyle = (() => {
        const rest: React.CSSProperties = { ...(style as React.CSSProperties) };
        delete rest.paddingLeft;
        return rest;
      })();

      return (
        <div
          ref={dragHandle}
          style={computedStyle}
          data-path={node.id}
          data-file-node
          className={cn(
            "relative flex items-center h-7 px-2 cursor-pointer select-none text-sm transition-all duration-150",
            node.isSelected
              ? "bg-maek-red/10 text-maek-red"
              : "text-neutral-ink hover:bg-surface-overlay",
            node.isDragging && "opacity-50",
          )}
          onClick={(e) => {
            node.handleClick(e);
            if (node.data.isDir) {
              const database = databases.find((d) => d.folderPath === node.data.id);
              if (database && !browseFolders.includes(node.data.id)) useStore.getState().openDatabase(database.folderPath, database.name);
              else node.toggle();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, node: node.data });
          }}
        >
          {/* Drop target highlight overlay */}
          {node.willReceiveDrop && (
            <div
              className="absolute pointer-events-none z-10"
              style={{
                top: 0,
                left: 0,
                right: 0,
                height: (() => {
                  if (!node.isOpen) return 28;
                  const visibleNodes = node.tree.visibleNodes;
                  let count = 0;
                  for (let i = (node.rowIndex ?? 0) + 1; i < visibleNodes.length; i++) {
                    if (visibleNodes[i]!.level <= node.level) break;
                    count++;
                  }
                  return (1 + count) * 28;
                })(),
                backgroundColor: 'color-mix(in srgb, var(--color-maek-red) 8%, transparent)',
                borderLeft: '2px solid color-mix(in srgb, var(--color-maek-red) 50%, transparent)',
                borderRadius: '2px'
              }}
            />
          )}
          {/* Depth guide lines: inline spans that create indent + vertical line */}
          {Array.from({ length: node.level }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className="shrink-0 self-stretch border-l border-[var(--color-border-subtle)]"
              style={{ width: 12 }}
            />
          ))}
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {node.isInternal && (
              <ChevronRight
                className={cn(
                  "w-3 h-3 transition-transform",
                  node.isOpen && "rotate-90",
                )}
              />
            )}
          </span>
          {node.isInternal ? (
            databases.some((database) => database.folderPath === node.data.id) ? (
              <Table className="w-4 h-4 mr-2 shrink-0 text-maek-red" />
            ) : appearances[node.data.id] ? (
              <span className="mr-2 flex items-center justify-center">
                {(() => {
                  const app = appearances[node.data.id]!;
                  const IconComponent = FOLDER_ICON_MAP[app.icon as keyof typeof FOLDER_ICON_MAP];
                  if (IconComponent) {
                    return <IconComponent size={16} style={{ color: getFolderIconColorValue(app.iconColor) }} />;
                  }
                  return null;
                })()}
              </span>
            ) : null
          ) : /\.csv$/i.test(node.data.name) ? (
            <Table2 className="w-4 h-4 mr-2 shrink-0" />
          ) : /\.html$/i.test(node.data.name) ? (
            <FileCode className="w-4 h-4 mr-2 shrink-0" />
          ) : !/\.md$/i.test(node.data.name) ? (
            <File className="w-4 h-4 mr-2 shrink-0" />
          ) : null}
          {node.isEditing ? (
            <input
              autoFocus
              aria-label="File name"
              defaultValue={node.data.name}
              className="flex-1 min-w-0 text-sm bg-surface border border-maek-red/50 rounded px-1 outline-none"
              onFocus={(e) => e.target.select()}
              onBlur={(e) => node.submit(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void node.submit(e.currentTarget.value);
                if (e.key === "Escape") node.reset();
              }}
            />
          ) : (
            <span className={cn("truncate", !node.isInternal && !appearances[node.data.id] && !/\.md$/i.test(node.data.name) ? "" : "ml-1")}>
              {node.data.name}
            </span>
          )}
        </div>
      );
    },
    [appearances, databases, browseFolders],
  );
  return (
    <div
      className="h-full flex flex-col"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).matches("input,textarea")) return;
        const cmd = e.metaKey || e.ctrlKey;
        if (cmd && e.key === "c") {
          e.preventDefault();
          setClipboard(selection.map((n) => n.id));
        }
        if (cmd && e.key === "v") {
          e.preventDefault();
          void run(() => paste());
        }
        if (cmd && e.key === "d") {
          e.preventDefault();
          void run(async () => {
            await api("/api/files/copy", "POST", {
              dir: selection[0]?.parent ?? "",
              paths: selection.map((n) => n.id),
            });
            await useStore.getState().refresh();
          });
        }
        if ((e.key === "Backspace" && cmd) || e.key === "Delete") {
          e.preventDefault();
          requestTrash(selection.map((n) => n.id));
        }
      }}
    >
      <div className="h-[52px] px-3 pt-2 pb-1 flex items-center gap-1 shrink-0">
        <div className="flex-1 min-w-0">
          <FolderSelector
            currentFolderName={workspace?.name ?? null}
            currentFolderPath={workspace?.root ?? null}
            workspaces={workspaces}
            onOpenFolder={() => void useStore.getState().openWorkspace()}
            onSelectWorkspace={(w) =>
              void useStore.getState().openWorkspace(w.path)
            }
            isLoading={restoring}
          />
        </div>
        <button
          className="sidebar-toggle-button"
          aria-label="Close sidebar"
          onClick={onCollapse}
        >
          <PanelIcon side="left" isExpanded={true} size={16} />
        </button>
      </div>
      <div className="px-3 pb-2 shrink-0 space-y-1">
        <button
          className="w-full h-8 px-2 rounded-md flex items-center gap-2 text-sm text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
          aria-label="Search content"
          onClick={onSearch}
        >
          <Search size={15} />
          <span>Search</span>
          <kbd className="ml-auto text-[11px] text-muted-text font-sans">⌘P</kbd>
        </button>
        <button
          ref={createButtonRef}
          className="w-full h-8 px-2 rounded-md flex items-center gap-2 text-sm text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
          aria-label="Add new"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            createHoverMenu.open({ x: rect.left, y: rect.bottom });
          }}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            createHoverMenu.open({ x: r.left, y: r.bottom });
          }}
          onMouseLeave={() => {
            createHoverMenu.startCloseTimer();
          }}
        >
          <Plus size={15} />
          <span>Add new</span>
          <kbd className="ml-auto text-[11px] text-muted-text font-sans">⌘N</kbd>
        </button>
      </div>
      <div ref={container} className="explorer-content-scroll flex-1 min-h-0 overflow-y-auto">
      {tabs.length > 0 && (
        <div className="flex flex-col">
          <div className="pl-5 pr-3 pt-2 pb-1 text-sm font-semibold tracking-wide text-muted-text flex items-center shrink-0">
            <span className="flex items-center gap-2">
              Open Tabs
              {saveStatus && (
                <span
                  data-testid="open-tabs-save-status"
                  role="status"
                  aria-label={saveStatus}
                  title={saveStatus}
                  className={cn(
                    "block w-2 h-2 rounded-full bg-[var(--color-maek-red)] shrink-0",
                    saveStatus === "Saving" && "motion-safe:animate-pulse",
                  )}
                />
              )}
            </span>
          </div>
          <div className="px-3 pb-1">
              {tabs.map((t, index) => t.isPopup ? null : (
                <div key={t.id}>
                  <div
                    aria-hidden
                    className="h-0 border-t-2 -my-px transition-colors"
                    style={{
                      borderTopColor:
                        dropIndex === index
                          ? "var(--color-maek-red)"
                          : "transparent",
                    }}
                  />
                  <div
                    role="tab"
                    aria-selected={t.id === activeTabId}
                    data-tab-id={t.id}
                    tabIndex={0}
                    onPointerDown={(e) => {
                      if (e.button !== 0 || e.target instanceof HTMLButtonElement) return;
                      dragTab.current = {
                        id: t.id,
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        dragging: false,
                      };
                    }}
                    onClick={() => {
                      if (suppressTabClick.current) {
                        suppressTabClick.current = false;
                        return;
                      }
                      useStore.getState().setActiveTab(t.id);
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1)
                        void useStore.getState().closeTab(t.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setOpenNotesMenu({ x: e.clientX, y: e.clientY, id: t.id });
                    }}
                    className={cn(
                      "group flex items-center gap-1.5 h-7 px-2 rounded-md cursor-pointer select-none text-sm transition-colors",
                      t.id === activeTabId
                        ? "bg-maek-red/10 text-maek-red"
                        : "text-neutral-ink hover:bg-surface-overlay",
                    )}
                  >
                    <span className="truncate flex-1 min-w-0">
                      {t.name}
                    </span>
                    {tabs.some(
                      (other) => other.id !== t.id && other.name === t.name,
                    ) && (
                      <span className="text-[10px] text-muted-text shrink-0">
                        {t.parentName}
                      </span>
                    )}
                    {isTabDirty(t) || t.status === "saving" ? (
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full bg-[var(--color-maek-red)] shrink-0",
                          t.status === "saving" && "motion-safe:animate-pulse",
                        )}
                        aria-label={t.status === "saving" ? "Saving" : "Unsaved"}
                        title={t.status === "saving" ? "Saving" : "Unsaved"}
                      />
                    ) : null}
                    <button
                      aria-label={"Close " + t.name}
                      className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-overlay-strong shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        void useStore.getState().closeTab(t.id);
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
              <div
                aria-hidden
                className="h-0 border-t-2 -my-px transition-colors"
                style={{
                  borderTopColor:
                    dropIndex === tabs.length
                      ? "var(--color-maek-red)"
                      : "transparent",
                }}
              />
          </div>
        </div>
      )}
      <div
        className="pl-5 pr-3 pt-2 pb-1 text-sm font-semibold tracking-wide text-muted-text flex items-center justify-between shrink-0"
      >
        <span>Files</span>
        <span className="flex items-center gap-1">
          <button
            className="icon-button w-6 h-6"
            aria-label="Refresh folder tree"
            onClick={(e) => {
              e.stopPropagation();
              void useStore.getState().refresh();
            }}
          >
            <RefreshCw size={14} />
          </button>
        </span>
      </div>
      <div
        className="px-2"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("[data-file-node]")) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, node: null });
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          const p = (e.target as HTMLElement)
            .closest("[data-path]")
            ?.getAttribute("data-path");
          const n = nodes.find((n) => n.id === p);
          const dir = n?.isDir ? n.id : (n?.parent ?? "");
          const files = collectDropFiles(e.dataTransfer);
          void run(async () => {
            await api("/api/files/import", "POST", {
              dir,
              files: await Promise.all(
                (await files).map(async (f) => ({
                  name: f.name,
                  data: await toBase64(f.file),
                })),
              ),
            });
            await useStore.getState().refresh();
          });
        }}
      >
        <Tree
          key={workspace?.wsId}
          ref={tree}
          data={data}
          width="100%"
          height={Math.max(1, visibleNodeCount * 28)}
          rowHeight={28}
          indent={12}
          overscanCount={5}
          openByDefault={false}
          initialOpenState={Object.fromEntries(expanded.map((p) => [p, true]))}
          onSelect={(ns) => {
            const selected = ns.map((n) => n.data);
            setSelection(selected);
            // Translate react-arborist selection into file-open intent at the
            // Tree boundary. This keeps mouse and keyboard selection aligned
            // and avoids racing a row click against Arborist's state update.
            if (selected.length === 1 && !selected[0]!.isDir)
              void useStore.getState().openFile(selected[0]!.id);
          }}
          onToggle={(id) => {
            useStore.setState((s) => ({
              expanded: tree.current?.isOpen(id)
                ? [...new Set([...s.expanded, id])]
                : s.expanded.filter((p) => p !== id),
            }));
            schedulePersistence();
          }}
          onRename={async ({ id, name }) => {
            await run(() =>
              useStore
                .getState()
                .move(id, [...id.split("/").slice(0, -1), name].join("/")),
            );
          }}
          onMove={async ({ dragIds, parentId }) => {
            const targetDir = parentId === "__REACT_ARBORIST_INTERNAL_ROOT__" || !parentId ? "" : parentId;
            await run(async () => {
              for (const id of dragIds) {
                await useStore
                  .getState()
                  .move(
                    id,
                    [targetDir, id.split("/").pop()].filter(Boolean).join("/"),
                  );
              }
            });
          }}
          disableDrop={({ parentNode, dragNodes }) => {
            // Allow drop to root
            if (!parentNode || parentNode.id === "__REACT_ARBORIST_INTERNAL_ROOT__") {
              return false;
            }
            // Cannot drop on a file (only folders)
            if (!parentNode.data.isDir) return true;

            return dragNodes.some(
              (n) =>
                parentNode.id === n.id || parentNode.id.startsWith(n.id + "/"),
            );
          }}
        >
          {Node}
        </Tree>
        {nodes.length === 0 && (
          <p className="text-sm text-muted-text text-center -mt-32 pointer-events-none">
            No files found
          </p>
        )}
      </div>
      </div>
      <div className="mt-auto px-3 py-2 shrink-0 flex items-center justify-between">
        <button
          className="icon-button"
          aria-label="Open settings"
          onClick={onSettings}
        >
          <Settings size={16} />
        </button>
        <button
          className="icon-button text-maek-red hover:bg-red-50 dark:hover:bg-red-950/30"
          aria-label="Quit server"
          title="Quit server"
          onClick={onQuit}
        >
          <Power size={16} />
        </button>
      </div>
      {menu && (
        <FloatingMenu isOpen position={menu} onClose={() => setMenu(null)}>
          <MenuItem
            label="New note"
            onClick={() => void run(() => create("file"))}
          />
          <MenuItem
            label="New folder"
            onClick={() => void run(() => create("dir"))}
          />
          <MenuItem
            label="New database"
            onClick={() => void run(() => createDatabase())}
          />
          <MenuSeparator />
          {menu.node?.isDir && (databases.some(d=>d.folderPath===menu.node!.id) ? <>
            <MenuItem label="Open database" onClick={()=>{const db=databases.find(d=>d.folderPath===menu.node!.id)!;setBrowseFolders(s=>s.filter(p=>p!==db.folderPath));useStore.getState().openDatabase(db.folderPath,db.name);setMenu(null)}}/>
            <MenuItem label="Browse as folder" onClick={()=>{const id=menu.node!.id;setBrowseFolders(s=>[...s,id]);tree.current?.get(id)?.open();setMenu(null)}}/>
            <MenuItem label="Remove database" onClick={()=>void run(async()=>{const db=databases.find(d=>d.folderPath===menu.node!.id)!;await api('/api/databases/command','POST',{databaseId:db.id,action:'unregister'});setDatabases(await api<DatabaseMeta[]>('/api/databases'));for(const tab of useStore.getState().tabs.filter(t=>t.databaseFolderPath===db.folderPath))await useStore.getState().closeTab(tab.id)})}/>
          </> : <MenuItem label="Turn into database" onClick={()=>void run(async()=>{const db=await api<DatabaseMeta>('/api/databases/convert','POST',{folderPath:menu.node!.id});setDatabases(await api<DatabaseMeta[]>('/api/databases'));useStore.getState().openDatabase(db.folderPath,db.name)})}/>)}
          {menu.node && (
            <>
              <MenuItem
                label="Rename"
                onClick={() => {
                  const id = menu.node!.id;
                  setMenu(null);
                  void tree.current?.get(id)?.edit();
                }}
              />
              <MenuItem
                label="Copy"
                onClick={() => {
                  setClipboard(contextPaths());
                  setMenu(null);
                }}
              />
              <MenuItem
                label="Duplicate"
                onClick={() =>
                  void run(async () => {
                    await api("/api/files/copy", "POST", {
                      dir: menu.node?.parent ?? "",
                      paths: contextPaths(),
                    });
                    await useStore.getState().refresh();
                  })
                }
              />

              {menu.node.isDir && (
                <FolderCustomizeSubmenu
                  folderPath={menu.node.id}
                  folderName={menu.node.name}
                  onClose={() => setMenu(null)}
                />
              )}
            </>
          )}
          <MenuItem
            label="Paste"
            disabled={!clipboard.length}
            onClick={() => void run(() => paste())}
          />
          {menu.node && (
            <>
              <MenuSeparator />
              <MenuItem
                label="Reveal in Finder"
                onClick={() =>
                  void run(() =>
                    api("/api/files/open-external", "POST", {
                      path: menu.node!.id,
                      reveal: true,
                    }),
                  )
                }
              />
              <MenuItem
                destructive
                icon={<Trash2 size={16} />}
                label="Move to Trash"
                onClick={() => requestTrash(contextPaths())}
              />
            </>
          )}
        </FloatingMenu>
      )}
      {createHoverMenu.isOpen && (
        <FloatingMenu
          isOpen
          position={createHoverMenu.position}
          anchorRef={createButtonRef}
          onClose={() => createHoverMenu.close()}
          onMouseEnter={createHoverMenu.cancelCloseTimer}
          onMouseLeave={createHoverMenu.startCloseTimer}
          minWidth={createButtonRef.current?.getBoundingClientRect().width ?? 0}
          offset={0}
        >
          <MenuItem
            icon={<FileText size={16} />}
            label="New note"
            onClick={() => {
              createHoverMenu.close();
              void run(() => create("file"));
            }}
          />
          <MenuItem
            icon={<Table size={16} />}
            label="New database"
            onClick={() => {
              createHoverMenu.close();
              void run(() => createDatabase());
            }}
          />
          <MenuItem
            icon={<FolderPlus size={16} />}
            label="New folder"
            onClick={() => {
              createHoverMenu.close();
              void run(() => create("dir"));
            }}
          />
        </FloatingMenu>
      )}
      <ConfirmDialog
        open={pendingTrash !== null}
        title="Move to Trash?"
        description={
          pendingTrash
            ? pendingTrash.paths.length === 1
              ? `“${pendingTrash.label}” will be moved to Trash. You can recover it from Trash.`
              : `${pendingTrash.label} will be moved to Trash. You can recover them from Trash.`
            : ""
        }
        confirmLabel="Move to Trash"
        busy={trashBusy}
        onCancel={() => setPendingTrash(null)}
        onConfirm={() => void confirmTrash()}
      />
      {openNotesMenu && (
        <FloatingMenu
          isOpen
          position={openNotesMenu}
          onClose={() => setOpenNotesMenu(null)}
        >
          {!openNotesMenu.id.startsWith("maek:virtual:") && (
            <>
              <MenuItem
                label="Open to the Side"
                onClick={() => {
                  void useStore.getState().openFileToSide(openNotesMenu.id);
                  setOpenNotesMenu(null);
                }}
              />
              <MenuItem
                label="Show in file tree"
                onClick={() => {
                  revealInFolderTree(openNotesMenu.id);
                  setOpenNotesMenu(null);
                }}
              />
              <MenuSeparator />
            </>
          )}
          <MenuItem
            label="Close"
            onClick={() => {
              void useStore.getState().closeTab(openNotesMenu.id);
              setOpenNotesMenu(null);
            }}
          />
          <MenuItem
            label="Close others"
            onClick={() => {
              for (const t of useStore.getState().tabs)
                if (t.id !== openNotesMenu.id)
                  void useStore.getState().closeTab(t.id);
              setOpenNotesMenu(null);
            }}
          />
          <MenuItem
            label="Close all"
            onClick={() => {
              for (const t of useStore.getState().tabs)
                void useStore.getState().closeTab(t.id);
              setOpenNotesMenu(null);
            }}
          />
        </FloatingMenu>
      )}

      {/* Drag Preview */}
      <div
        ref={dragPreviewRef}
        className="fixed top-0 left-0 pointer-events-none z-50 flex items-center gap-1.5 h-7 px-2 rounded-md bg-surface-overlay text-neutral-ink text-sm shadow border border-border-subtle opacity-60"
        style={{ display: "none" }}
      >
        <FileText className="w-4 h-4 shrink-0" />
        <span ref={dragPreviewTextRef} className="truncate flex-1 min-w-0" />
      </div>

    </div>
  );
}
