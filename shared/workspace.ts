export interface FileNode {
  id: string;
  name: string;
  parent: string | null;
  isDir: boolean;
  /** Reserved for the planned database view. Current workspace scans omit it. */
  isDatabase?: boolean;
  children?: FileNode[];
}
export interface MaekWorkspace {
  id: string;
  name: string;
  path: string;
}
export type PreviewKind =
  | "editor"
  | "sheet"
  | "image"
  | "pdf"
  | "text"
  | "html"
  | "unsupported";
export interface FileContent {
  content?: string;
  kind: PreviewKind;
  hash: string;
  mtimeMs: number;
  size: number;
}
export interface Session {
  tabs: string[];
  activeTabId: string | null;
  scrollPositions: Record<string, number>;
  expanded: string[];
  theme: "system" | "light" | "dark";
  sidebarWidth: number;
}
/**
 * The open-tab list and order, sourced from the workspace-root `.maek/tabs.json`
 * (original app version-4 format). Shared across every browser viewing the same
 * workspace. Paths are workspace-relative; only web-supported file tabs appear.
 */
export interface RootTabs {
  tabs: string[];
  /** The active tab recorded in the root document (informational; per-browser
   * selection lives in UiState). */
  activeTabId: string | null;
}

/** A browser-local tab workspace. Unlike RootTabs, this records how open files
 * are composed on screen and is never shared with another browser session. */
export type ViewGroup =
  | { id: string; kind: "single"; tabId: string }
  | {
      id: string;
      kind: "split";
      left: string;
      right: string;
      active: "left" | "right";
      ratio: number;
    };
/**
 * Per-browser presentation state that must not be shared through the root tab
 * document. Stored in `.maek/sessions/web/<session-id>/ui.json`.
 */
export interface UiState {
  activeTabId: string | null;
  scrollPositions: Record<string, number>;
  expanded: string[];
  theme: "system" | "light" | "dark";
  sidebarWidth: number;
  split?: { left: string | null; right: string | null; active: "left" | "right"; ratio: number };
  /** v2 browser-local tab composition. `split` remains for migration from v1. */
  viewGroups?: ViewGroup[];
  activeViewGroupId?: string | null;
}
export interface Change {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir" | "rename";
  path: string;
  source?: string;
  node?: FileNode;
}
export interface WorkspaceEvent {
  id: number;
  workspaceRevision: number;
  event:
    | "ready"
    | "rescan"
    | "change"
    | "watch-error"
    | "tabs-session-changed";
  data: Change | Record<string, never>;
}
