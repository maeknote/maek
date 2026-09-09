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
  theme: "light" | "dark";
  sidebarWidth: number;
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
  event: "ready" | "rescan" | "change" | "watch-error";
  data: Change | Record<string, never>;
}
