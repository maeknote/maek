import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { Tree, type TreeApi, type NodeRendererProps, type NodeApi } from "react-arborist";
import {
  ChevronRight,
  Columns2,
  FileText,
  FolderPlus,
  Plus,
  Power,
  RefreshCw,
  Search,
  Table,
  Settings,
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
import type { FolderAppearance } from "./utils/folderAppearance";
import { cn } from "../../lib/utils";
import { collectDropFiles } from "./importDrop";
import { useFolderAppearance } from "./stores/folderAppearanceStore";
import { FolderCustomizeSubmenu } from "./components/FolderCustomizeSubmenu";
import { FileNameLabel } from "../editor/components/FileNameLabel";
import { FOLDER_ICON_MAP, getFolderIconColorValue } from "./utils/folderAppearance";
import { isTabDirty } from "../editor/utils/frontmatter";
import {
  edgeScrollDelta,
  isSelfOrDescendantDrop,
} from "./utils/treeDnd";
import { UnifiedTreeOuter } from "./components/UnifiedTreeOuter";
import {
  useUnifiedExplorerScroll,
  SECTION_HEADER_HEIGHT,
} from "./hooks/useUnifiedExplorerScroll";
import { clamp, maxTreeOffset } from "./utils/unifiedScroll";

const ROW_HEIGHT = 28;
const ROOT_ID = "__REACT_ARBORIST_INTERNAL_ROOT__";

interface Props {
  onSearch: () => void;
  onSettings: () => void;
  onCollapse: () => void;
  onQuit: () => void;
}

/**
 * Everything the module-scope Node renderer needs, supplied through context so
 * that changing databases/appearances/handlers never remounts the whole tree
 * (which is what previously wiped the rename input and re-ran clicks).
 */
interface TreeContextValue {
  databaseFolders: Set<string>;
  appearances: Record<string, FolderAppearance>;
  browseFolders: Set<string>;
  onRowClick: (node: NodeApi<FileNode>, event: React.MouseEvent) => void;
  onChevronClick: (node: NodeApi<FileNode>, event: React.MouseEvent) => void;
  onRowDoubleClick: (node: NodeApi<FileNode>) => void;
  onContextMenu: (node: NodeApi<FileNode>, event: React.MouseEvent) => void;
}

const TreeContext = createContext<TreeContextValue | null>(null);

function useTreeContext(): TreeContextValue {
  const value = useContext(TreeContext);
  if (!value) throw new Error("Node rendered outside of TreeContext");
  return value;
}

/**
 * Stable, module-scope row renderer. It reads dynamic data from context rather
 * than closing over Explorer state, so react-arborist can keep node instances
 * mounted across data refreshes.
 */
function Node({ node, style, dragHandle }: NodeRendererProps<FileNode>) {
  const {
    databaseFolders,
    appearances,
    onRowClick,
    onChevronClick,
    onRowDoubleClick,
    onContextMenu,
  } = useTreeContext();
  const isDir = node.data.isDir;
  const isDatabase = isDir && databaseFolders.has(node.data.id);
  const appearance = appearances[node.data.id];

  // Strip react-arborist's auto-injected paddingLeft so the depth guide spans
  // are the single source of indent (matches the desktop design).
  const computedStyle: React.CSSProperties = { ...(style as React.CSSProperties) };
  delete computedStyle.paddingLeft;

  return (
    <div
      ref={dragHandle}
      style={computedStyle}
      data-path={node.id}
      data-file-node
      className={cn(
        "relative flex items-center h-7 px-2 cursor-pointer select-none text-sm transition-colors duration-150",
        node.isSelected
          ? "bg-maek-red/10 text-maek-red"
          : "text-neutral-ink hover:bg-surface-overlay",
        node.isDragging && "opacity-50",
      )}
      onClick={(e) => onRowClick(node, e)}
      onDoubleClick={() => onRowDoubleClick(node)}
      onContextMenu={(e) => onContextMenu(node, e)}
    >
      {/* Drop target highlight overlay: react-arborist marks the resolved drop
          parent with willReceiveDrop. We paint the folder and its visible
          subtree instead of drawing a sibling insertion line. */}
      {node.willReceiveDrop && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            top: 0,
            left: 0,
            right: 0,
            height: (() => {
              if (!node.isOpen) return ROW_HEIGHT;
              const visibleNodes = node.tree.visibleNodes;
              let count = 0;
              for (let i = (node.rowIndex ?? 0) + 1; i < visibleNodes.length; i++) {
                if (visibleNodes[i]!.level <= node.level) break;
                count++;
              }
              return (1 + count) * ROW_HEIGHT;
            })(),
            backgroundColor: "color-mix(in srgb, var(--color-maek-red) 8%, transparent)",
            borderLeft: "2px solid color-mix(in srgb, var(--color-maek-red) 50%, transparent)",
            borderRadius: "2px",
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
      <span
        className="w-4 h-4 flex items-center justify-center shrink-0"
        onClick={(e) => {
          // The chevron toggles a folder regardless of row-click behaviour. For
          // database folders this is the ONLY way to expand/collapse, because a
          // plain row click opens the database instead.
          if (node.isInternal) onChevronClick(node, e);
        }}
      >
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
        isDatabase ? (
          <Table className="w-4 h-4 mr-2 shrink-0 text-maek-red" />
        ) : appearance ? (
          <span className="mr-2 flex items-center justify-center">
            {(() => {
              const IconComponent =
                FOLDER_ICON_MAP[appearance.icon as keyof typeof FOLDER_ICON_MAP];
              return IconComponent ? (
                <IconComponent
                  size={16}
                  style={{ color: getFolderIconColorValue(appearance.iconColor) }}
                />
              ) : null;
            })()}
          </span>
        ) : null
      ) : null}
      {node.isEditing ? (
        <RenameInput node={node} />
      ) : node.isInternal ? (
        <span
          className={cn(
            "truncate",
            !appearance && !isDatabase ? "" : "ml-1",
          )}
        >
          {node.data.name}
        </span>
      ) : (
        // File rows carry no file-type icon; the extension is shown as muted
        // secondary text inline with the name instead.
        <FileNameLabel fileName={node.data.name} title={node.data.name} />
      )}
    </div>
  );
}

/**
 * Isolated rename input. It owns an uncontrolled value and a single-shot submit
 * guard so a workspace-change re-render during editing cannot lose the typed
 * value or double-submit on Enter-then-blur.
 */
function RenameInput({ node }: { node: NodeApi<FileNode> }) {
  const submittedRef = useRef(false);
  const submit = (value: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    void node.submit(value);
  };
  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    node.reset();
  };
  return (
    <input
      autoFocus
      aria-label="File name"
      defaultValue={node.data.name}
      className="flex-1 min-w-0 text-sm bg-surface border border-maek-red/50 rounded px-1 outline-none"
      onFocus={(e) => e.target.select()}
      // Prevent the row's click/selection handlers from firing while editing.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => submit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          submit(e.currentTarget.value);
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
    />
  );
}

export function Explorer({ onSearch, onSettings, onCollapse, onQuit }: Props) {
  const {
    nodes,
    workspace,
    restoring,
    expanded,
    workspaces,
    tabs,
    viewGroups,
    activeViewGroupId,
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
  // Bridge to the unified-scroll helpers (populated after the hook runs) so the
  // tab-drag pointer handler, defined before the hook, can drive the shared
  // scroller for edge auto-scroll during long-list reordering.
  const scrollBridge = useRef<{
    scrollEl: HTMLDivElement | null;
    filesSectionTop: () => number;
    scrollTo: (top: number) => void;
  }>({ scrollEl: null, filesSectionTop: () => 0, scrollTo: () => {} });
  const tabAutoScrollFrame = useRef<number | null>(null);
  const tabAutoScrollSpeed = useRef(0);
  const [pendingReveal, setPendingReveal] = useState<{ id: string } | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const saveStatus = tabs.some((tab) => tab.status === "saving")
    ? "Saving"
    : tabs.some(isTabDirty) ? "Unsaved" : null;
  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const visibleViewGroups = useMemo(
    () => viewGroups.filter((group) => {
      const ids = group.kind === "single" ? [group.tabId] : [group.left, group.right];
      return ids.some((id) => !tabById.get(id)?.isPopup);
    }),
    [viewGroups, tabById],
  );
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
    groupId?: string;
  } | null>(null);
  const { appearances, load } = useFolderAppearance();

  const updateDropIndex = useCallback((index: number | null) => {
    dropIndexRef.current = index;
    setDropIndex(index);
  }, []);

  useEffect(() => {
    const stopTabAutoScroll = () => {
      tabAutoScrollSpeed.current = 0;
      if (tabAutoScrollFrame.current !== null) {
        cancelAnimationFrame(tabAutoScrollFrame.current);
        tabAutoScrollFrame.current = null;
      }
    };
    const runTabAutoScroll = () => {
      const el = scrollBridge.current.scrollEl;
      if (!el || tabAutoScrollSpeed.current === 0) {
        tabAutoScrollFrame.current = null;
        return;
      }
      // Min 0 (top of Open Tabs); max = the Files section top, which brings the
      // last tab row into view without scrolling deep into Files.
      const max = scrollBridge.current.filesSectionTop();
      const next = Math.min(
        max,
        Math.max(0, el.scrollTop + tabAutoScrollSpeed.current),
      );
      if (next !== el.scrollTop) scrollBridge.current.scrollTo(next);
      tabAutoScrollFrame.current = requestAnimationFrame(runTabAutoScroll);
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragTab.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.dragging) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5)
          return;
        drag.dragging = true;
        suppressTabClick.current = true;

        const group = useStore.getState().viewGroups.find((item) => item.id === drag.id);
        if (group && dragPreviewTextRef.current) {
          const ids = group.kind === "single" ? [group.tabId] : [group.left, group.right];
          dragPreviewTextRef.current.textContent = ids
            .map((id) => useStore.getState().tabs.find((tab) => tab.id === id)?.name ?? id)
            .join(" · ");
        }
      }

      if (dragPreviewRef.current) {
        dragPreviewRef.current.style.transform = `translate(${event.clientX + 10}px, ${event.clientY + 10}px)`;
        dragPreviewRef.current.style.display = "flex";
      }

      event.preventDefault();

      // Edge auto-scroll so long tab lists can be reordered beyond the current
      // viewport. Measured against the shared scroller; clamped so a tab drag
      // does not run deep into Files (max = the Files section top).
      const scrollEl = scrollBridge.current.scrollEl;
      if (scrollEl) {
        const scrollerRect = scrollEl.getBoundingClientRect();
        tabAutoScrollSpeed.current = edgeScrollDelta(event.clientY, {
          top: scrollerRect.top,
          bottom: scrollerRect.bottom,
        });
        if (tabAutoScrollSpeed.current !== 0 && tabAutoScrollFrame.current === null) {
          tabAutoScrollFrame.current = requestAnimationFrame(runTabAutoScroll);
        } else if (tabAutoScrollSpeed.current === 0) {
          stopTabAutoScroll();
        }
      }

      const row = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-view-group-id]");
      if (!row) {
        return;
      }
      const currentGroups = useStore.getState().viewGroups;
      const index = currentGroups.findIndex((group) => group.id === row.dataset.viewGroupId);
      if (index < 0) return;
      const rect = row.getBoundingClientRect();
      updateDropIndex(event.clientY - rect.top > rect.height / 2 ? index + 1 : index);
    };
    const finishPointerDrag = (event: PointerEvent) => {
      const drag = dragTab.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      stopTabAutoScroll();
      dragTab.current = null;
      if (dragPreviewRef.current) {
        dragPreviewRef.current.style.display = "none";
      }
      if (drag.dragging && dropIndexRef.current !== null) {
        const from = useStore.getState().viewGroups.findIndex((group) => group.id === drag.id);
        useStore.getState().reorderViewGroups(from, dropIndexRef.current);
      }
      updateDropIndex(null);
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
      stopTabAutoScroll();
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
  const [browseFolders] = useState<string[]>([]);
  const [databases, setDatabases] = useState<DatabaseMeta[]>([]);

  // The database registry only changes when the workspace loads, its manifests
  // change, or the directory structure changes. Ordinary document saves emit a
  // "change" event for a Markdown file, which must NOT trigger a refetch (the
  // previous code re-queried on every workspace-change and remounted the tree).
  useEffect(() => {
    if (!workspace) {
      setDatabases([]);
      return;
    }
    let cancelled = false;
    const refresh = () =>
      void api<DatabaseMeta[]>("/api/databases")
        .then((d) => {
          if (!cancelled) setDatabases(d);
        })
        .catch(() => {});
    refresh();
    const onChange = (event: Event) => {
      const path = (event as CustomEvent<{ type?: string; path?: string }>).detail
        ?.path;
      const type = (event as CustomEvent<{ type?: string; path?: string }>).detail
        ?.type;
      if (!path) return;
      const isManifest =
        path.endsWith("/.maek-database.json") || path === ".maek-database.json";
      const isStructural =
        type === "add" ||
        type === "addDir" ||
        type === "unlink" ||
        type === "unlinkDir" ||
        type === "rename";
      if (isManifest || isStructural) refresh();
    };
    window.addEventListener("maek:workspace-change", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("maek:workspace-change", onChange);
    };
  }, [workspace?.wsId]);

  const databaseFolders = useMemo(
    () => new Set(databases.map((d) => d.folderPath)),
    [databases],
  );
  const browseFolderSet = useMemo(() => new Set(browseFolders), [browseFolders]);

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

  // Number of visible Open Tabs workspaces; drives the anchor-preservation shift.
  const tabCount = useMemo(
    () => visibleViewGroups.length,
    [visibleViewGroups],
  );

  // Total height of the pinned, stacked section headers. Open Tabs (when any
  // tabs exist) sits at top:0 and Files stacks directly beneath it, so the tree
  // viewport must start below both. With no tabs, only the Files header pins.
  const hasTabs = tabCount > 0;
  const headerStackHeight = hasTabs
    ? SECTION_HEADER_HEIGHT * 2
    : SECTION_HEADER_HEIGHT;

  const {
    sidebarScrollRef,
    filesSectionRef,
    filesViewportRef,
    treeViewportHeight,
    treeContentHeight,
    onSidebarScroll,
    scrollTreeNodeIntoView,
    measureFilesSectionTop,
    scrollSidebarTo,
  } = useUnifiedExplorerScroll({
    tree,
    data,
    expanded,
    workspaceRoot: workspace?.root ?? null,
    tabCount,
    headerStackHeight,
  });

  // Keep the tab-drag pointer handler's scroll bridge current. Also stop any
  // in-flight tab auto-scroll when the workspace changes.
  useEffect(() => {
    scrollBridge.current = {
      scrollEl: sidebarScrollRef.current,
      filesSectionTop: measureFilesSectionTop,
      scrollTo: scrollSidebarTo,
    };
  });
  useEffect(() => {
    return () => {
      tabAutoScrollSpeed.current = 0;
      if (tabAutoScrollFrame.current !== null) {
        cancelAnimationFrame(tabAutoScrollFrame.current);
        tabAutoScrollFrame.current = null;
      }
    };
  }, [workspace?.wsId]);

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
    void (async () => {
      const revealed = await scrollTreeNodeIntoView(id);
      if (cancelled) return;
      if (revealed && api.get(id)) {
        api.select(id, { align: "center" });
        container.current?.querySelector<HTMLElement>('[role="tree"]')?.focus();
      } else {
        useStore.getState().setError("Could not reveal this file in the folder tree.");
      }
      setPendingReveal(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingReveal, workspace?.wsId, scrollTreeNodeIntoView]);
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
    const database = await api<DatabaseMeta>("/api/databases", "POST", {
      parent: dir,
      name,
      viewType: "table",
    });
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
  /**
   * Shared creation actions (New note / New folder / New database) reused by the
   * empty-area menu, the Add New hover menu, and every folder row context menu
   * so their order, icons, and handlers stay identical. `dir` is the explicit
   * destination folder ("" for the workspace root). `onRun` closes the host
   * menu before running the action.
   */
  const creationActions = (dir: string, onRun: () => void) => (
    <>
      <MenuItem
        icon={<FileText size={16} />}
        label="New note"
        onClick={() => {
          onRun();
          void run(() => create("file", dir));
        }}
      />
      <MenuItem
        icon={<FolderPlus size={16} />}
        label="New folder"
        onClick={() => {
          onRun();
          void run(() => create("dir", dir));
        }}
      />
      <MenuItem
        icon={<Table size={16} />}
        label="New database"
        onClick={() => {
          onRun();
          void run(() => createDatabase(dir));
        }}
      />
    </>
  );
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

  // Row-click and chevron handlers are stable and read live data at call time,
  // so the context value they live in never invalidates node instances.
  const onRowClick = useCallback(
    (node: NodeApi<FileNode>, _event: React.MouseEvent) => {
      node.select();
      if (node.data.isDir) {
        const database = databases.find((d) => d.folderPath === node.data.id);
        if (database && !browseFolders.includes(node.data.id)) {
          // Database folder: a row click opens the database. Expansion is only
          // available via the chevron.
          useStore.getState().openDatabase(database.folderPath, database.name);
        } else {
          // Ordinary folder: a row click toggles open/closed.
          node.toggle();
        }
      } else {
        // Files open as a replaceable preview; double click pins them.
        void useStore.getState().openFile(node.data.id, { preview: true });
      }
    },
    [databases, browseFolders],
  );
  const onChevronClick = useCallback(
    (node: NodeApi<FileNode>, event: React.MouseEvent) => {
      // Stop the row click so a database folder toggles instead of opening.
      event.stopPropagation();
      node.toggle();
    },
    [],
  );
  const onRowDoubleClick = useCallback((node: NodeApi<FileNode>) => {
    if (!node.data.isDir) void useStore.getState().openFile(node.data.id);
  }, []);
  const onNodeContextMenu = useCallback(
    (node: NodeApi<FileNode>, event: React.MouseEvent) => {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, node: node.data });
    },
    [],
  );

  const treeContextValue = useMemo<TreeContextValue>(
    () => ({
      databaseFolders,
      appearances,
      browseFolders: browseFolderSet,
      onRowClick,
      onChevronClick,
      onRowDoubleClick,
      onContextMenu: onNodeContextMenu,
    }),
    [
      databaseFolders,
      appearances,
      browseFolderSet,
      onRowClick,
      onChevronClick,
      onRowDoubleClick,
      onNodeContextMenu,
    ],
  );

  // RAF-based edge auto-scroll while dragging inside the visible tree viewport.
  // It drives the shared scroller (not a nested Files container) and clamps to
  // the logical tree range so a tree drag can never scroll back into Open Tabs.
  const autoScrollFrame = useRef<number | null>(null);
  const autoScrollSpeed = useRef(0);
  const stopAutoScroll = useCallback(() => {
    autoScrollSpeed.current = 0;
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
  }, []);
  const runAutoScroll = useCallback(() => {
    const el = sidebarScrollRef.current;
    if (!el || autoScrollSpeed.current === 0) {
      autoScrollFrame.current = null;
      return;
    }
    const filesTop = measureFilesSectionTop();
    const min = filesTop;
    const max = filesTop + maxTreeOffset(treeContentHeight, treeViewportHeight);
    const next = clamp(el.scrollTop + autoScrollSpeed.current, min, max);
    if (next !== el.scrollTop) scrollSidebarTo(next);
    autoScrollFrame.current = requestAnimationFrame(runAutoScroll);
  }, [
    sidebarScrollRef,
    measureFilesSectionTop,
    treeContentHeight,
    treeViewportHeight,
    scrollSidebarTo,
  ]);
  useEffect(() => {
    // A tree DnD uses HTML5 drag events (react-dnd HTML5 backend). Listen on
    // the visible tree viewport so we can auto-scroll near its edges. The
    // native "Files" (Finder) import drop is handled separately below.
    const el = filesViewportRef.current;
    if (!el) return;
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) return; // Finder import
      // Highlight the whole Files area when the resolved drop destination is
      // the root (no folder under the cursor). willReceiveDrop already paints
      // folder destinations, so only the root case needs this.
      const api = tree.current;
      if (api) {
        const destination = api.dragDestinationParent;
        setRootDropActive(
          api.dragNodes.length > 0 &&
            (!destination || destination.id === ROOT_ID) &&
            api.canDrop(),
        );
      }
      const rect = el.getBoundingClientRect();
      const delta = edgeScrollDelta(event.clientY, {
        top: rect.top,
        bottom: rect.bottom,
      });
      autoScrollSpeed.current = delta;
      if (delta !== 0 && autoScrollFrame.current === null) {
        autoScrollFrame.current = requestAnimationFrame(runAutoScroll);
      } else if (delta === 0) {
        stopAutoScroll();
      }
    };
    const onDragLeave = (event: DragEvent) => {
      // Only stop when the pointer actually leaves the container bounds.
      const rect = el.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        stopAutoScroll();
        setRootDropActive(false);
      }
    };
    const clearDrag = () => {
      stopAutoScroll();
      setRootDropActive(false);
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", clearDrag);
    el.addEventListener("dragend", clearDrag);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", clearDrag);
      el.removeEventListener("dragend", clearDrag);
      stopAutoScroll();
    };
  }, [filesViewportRef, runAutoScroll, stopAutoScroll, workspace?.wsId]);

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
        </button>
        <button
          ref={createButtonRef}
          className="w-full h-8 px-2 rounded-md flex items-center gap-2 text-sm text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors"
          aria-label="Add new"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            createHoverMenu.open({ x: rect.left, y: rect.bottom });
          }}
        >
          <Plus size={15} />
          <span>Add new</span>
        </button>
      </div>
      {/* One continuous vertical scroller merges Open Tabs and Files. Both
          section headers are sticky and stack at the top: Open Tabs at top:0
          and Files just below it, so "Files" always sits under "Open Tabs" and
          both labels stay visible while the content scrolls beneath them. To
          keep each header pinned across the whole scroll range, the headers and
          their content are direct children of the single scroller (not nested
          per-section wrappers, which would unstick a header once its own
          content scrolled away). */}
      <div ref={container} className="flex-1 min-h-0 flex flex-col">
        <div
          ref={sidebarScrollRef}
          data-testid="explorer-content-scroll"
          className="explorer-content-scroll flex-1 min-h-0 overflow-y-auto"
          onScroll={onSidebarScroll}
        >
          {visibleViewGroups.length > 0 && (
            <>
              <div
                className="sticky top-0 z-30 bg-warm-vellum pl-5 pr-3 pt-2 pb-1 text-sm font-semibold tracking-wide text-muted-text flex items-center"
                style={{ height: SECTION_HEADER_HEIGHT }}
              >
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
                {visibleViewGroups.map((group, index) => {
                  const ids = group.kind === "single" ? [group.tabId] : [group.left, group.right];
                  const groupTabs = ids.map((id) => tabById.get(id)).filter(Boolean);
                  const primary = groupTabs[0];
                  const activeId = group.kind === "split"
                    ? (group.active === "left" ? group.left : group.right)
                    : group.tabId;
                  const split = group.kind === "split";
                  const dirty = groupTabs.some((tab) => tab && (isTabDirty(tab) || tab.status === "saving"));
                  if (!primary) return null;
                  return (
                    <div key={group.id}>
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
                      aria-selected={group.id === activeViewGroupId}
                      aria-label={split ? `Split view: ${groupTabs.map((tab) => tab!.name).join(" and ")}` : primary.name}
                      data-tab-id={primary.id}
                      data-view-group-id={group.id}
                      tabIndex={0}
                      onPointerDown={(e) => {
                        if (e.button !== 0 || e.target instanceof HTMLButtonElement)
                          return;
                        dragTab.current = {
                          id: group.id,
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
                        useStore.getState().setActiveViewGroup(group.id);
                      }}
                      onAuxClick={(e) => {
                        if (e.button === 1)
                          void useStore.getState().closeViewGroup(group.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setOpenNotesMenu({ x: e.clientX, y: e.clientY, id: activeId, groupId: group.id });
                      }}
                      className={cn(
                        "group flex items-center gap-1.5 h-7 px-2 rounded-md cursor-pointer select-none text-sm transition-colors",
                        groupTabs.some((tab) => tab?.isEphemeral) && "italic",
                        group.id === activeViewGroupId
                          ? "bg-maek-red/10 text-maek-red"
                          : "text-neutral-ink hover:bg-surface-overlay",
                      )}
                    >
                      {split ? (
                        <>
                          <Columns2 size={14} className="shrink-0" aria-hidden />
                          <span className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center gap-1.5" title={groupTabs.map((tab) => tab!.name).join(" · ")}>
                            <FileNameLabel fileName={groupTabs[0]!.name} className={group.active === "left" ? "font-semibold" : ""} />
                            <span className="h-3 bg-current opacity-20" aria-hidden />
                            <FileNameLabel fileName={groupTabs[1]!.name} className={group.active === "right" ? "font-semibold" : ""} />
                          </span>
                        </>
                      ) : <FileNameLabel fileName={primary.name} className="flex-1 min-w-0" title={primary.isEphemeral ? `${primary.name} (Preview)` : primary.name} />}
                      {!split && tabs.some(
                        (other) => other.id !== primary.id && other.name === primary.name,
                      ) && (
                        <span className="text-[10px] text-muted-text shrink-0">
                          {primary.parentName}
                        </span>
                      )}
                      {dirty ? (
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full bg-[var(--color-maek-red)] shrink-0",
                            groupTabs.some((tab) => tab?.status === "saving") && "motion-safe:animate-pulse",
                          )}
                          aria-label={groupTabs.some((tab) => tab?.status === "saving") ? "Saving" : "Unsaved"}
                          title={groupTabs.some((tab) => tab?.status === "saving") ? "Saving" : "Unsaved"}
                        />
                      ) : null}
                      <button
                        aria-label={"Close " + (split ? "split view" : primary.name)}
                        className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface-overlay-strong shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          void useStore.getState().closeViewGroup(group.id);
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                  );
                })}
                <div
                  aria-hidden
                  className="h-0 border-t-2 -my-px transition-colors"
                  style={{
                    borderTopColor:
                      dropIndex === visibleViewGroups.length
                        ? "var(--color-maek-red)"
                        : "transparent",
                  }}
                />
              </div>
            </>
          )}
          {/* Files header. It is sticky just below the Open Tabs header (top:32
              when tabs exist, top:0 otherwise) so both labels stack and stay
              visible. Its containing block is the scroller, so it stays pinned
              across the whole scroll range. */}
          <div
            className="sticky z-20 bg-warm-vellum pl-5 pr-3 pt-2 pb-1 text-sm font-semibold tracking-wide text-muted-text flex items-center justify-between"
            style={{
              top: tabs.some((t) => !t.isPopup) ? SECTION_HEADER_HEIGHT : 0,
              height: SECTION_HEADER_HEIGHT,
            }}
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
            ref={filesSectionRef}
            className="relative px-2"
            style={{ height: Math.max(1, treeContentHeight) }}
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
          {/* Sticky, viewport-sized window that holds the real virtual tree.
              It sits just below the stacked sticky headers and stays pinned as
              the shared scroller moves; the tree's own scroll offset is driven
              programmatically to match. The root-drop highlight is drawn around
              this visible viewport, not the full logical spacer. */}
          <div
            ref={filesViewportRef}
            className={cn(
              "sticky",
              rootDropActive &&
                "outline outline-2 -outline-offset-2 outline-[color-mix(in_srgb,var(--color-maek-red)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-maek-red)_5%,transparent)]",
            )}
            style={{ top: headerStackHeight, height: treeViewportHeight }}
          >
          <TreeContext.Provider value={treeContextValue}>
            <Tree
              key={workspace?.wsId}
              ref={tree}
              data={data}
              width="100%"
              height={Math.max(1, treeViewportHeight)}
              rowHeight={ROW_HEIGHT}
              indent={12}
              overscanCount={8}
              openByDefault={false}
              outerElementType={UnifiedTreeOuter}
              initialOpenState={Object.fromEntries(expanded.map((p) => [p, true]))}
              // Suppress the sibling insertion line entirely; folder/root
              // highlight is drawn via willReceiveDrop and the root outline.
              renderCursor={() => null}
              onSelect={(ns) => {
                setSelection(ns.map((n) => n.data));
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
                // Name-ordered tree: the sibling index is intentionally ignored.
                // Move every dragged item, then save + refresh exactly once.
                const targetDir =
                  parentId === ROOT_ID || !parentId ? "" : parentId;
                setRootDropActive(false);
                stopAutoScroll();
                await run(async () => {
                  if (!(await useStore.getState().saveAll())) return;
                  for (const id of dragIds) {
                    const dest = [targetDir, id.split("/").pop()]
                      .filter(Boolean)
                      .join("/");
                    if (dest === id) continue;
                    await api("/api/files/path", "PATCH", { source: id, dest });
                    useStore.getState().applyMoveToState(id, dest);
                  }
                  await useStore.getState().refresh();
                });
              }}
              disableDrop={({ parentNode, dragNodes }) => {
                // Root is always a valid destination.
                if (!parentNode || parentNode.id === ROOT_ID) return false;
                // Files can never receive a drop; only folders.
                if (!parentNode.data.isDir) return true;
                // Reject dropping a node into itself or its own subtree.
                return isSelfOrDescendantDrop(
                  parentNode.id,
                  dragNodes.map((n) => n.id),
                );
              }}
            >
              {Node}
            </Tree>
          </TreeContext.Provider>
          </div>
          {nodes.length === 0 && (
            <p className="text-sm text-muted-text text-center mt-8 pointer-events-none">
              No files found
            </p>
          )}
            </div>
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
          onClick={onQuit}
        >
          <Power size={16} />
        </button>
      </div>
      {menu && (
        <FloatingMenu isOpen position={menu} onClose={() => setMenu(null)}>
          {!menu.node && (
            <>
              {creationActions("", () => setMenu(null))}
              {clipboard.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuItem label="Paste" onClick={() => void run(() => paste(""))} />
                </>
              )}
            </>
          )}
          {menu.node?.isDir && (
            <>
              {creationActions(menu.node.id, () => setMenu(null))}
              <MenuSeparator />
            </>
          )}
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
          {menu.node?.isDir && clipboard.length > 0 && (
            <MenuItem label="Paste" onClick={() => void run(() => paste(menu.node!.id))} />
          )}
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
          minWidth={createButtonRef.current?.getBoundingClientRect().width ?? 0}
          offset={0}
        >
          {creationActions("", () => createHoverMenu.close())}
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
              <MenuItem
                label="Reveal in Finder"
                onClick={() => {
                  void run(() =>
                    api("/api/files/open-external", "POST", {
                      path: openNotesMenu.id,
                      reveal: true,
                    }),
                  );
                  setOpenNotesMenu(null);
                }}
              />
              <MenuSeparator />
            </>
          )}
          <MenuItem
            label="Close"
            onClick={() => {
              if (openNotesMenu.groupId)
                void useStore.getState().closeViewGroup(openNotesMenu.groupId);
              else
                void useStore.getState().closeTab(openNotesMenu.id);
              setOpenNotesMenu(null);
            }}
          />
          <MenuItem
            label="Close others"
            onClick={() => {
              if (openNotesMenu.groupId) {
                for (const group of useStore.getState().viewGroups)
                  if (group.id !== openNotesMenu.groupId)
                    void useStore.getState().closeViewGroup(group.id);
              } else {
                for (const t of useStore.getState().tabs)
                  if (t.id !== openNotesMenu.id)
                    void useStore.getState().closeTab(t.id);
              }
              setOpenNotesMenu(null);
            }}
          />
          <MenuItem
            label="Close all"
            onClick={() => {
              if (openNotesMenu.groupId) {
                for (const group of useStore.getState().viewGroups)
                  void useStore.getState().closeViewGroup(group.id);
              } else {
                for (const t of useStore.getState().tabs)
                  void useStore.getState().closeTab(t.id);
              }
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
