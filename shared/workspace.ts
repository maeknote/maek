export interface FileNode {
  id: string;
  name: string;
  parent: string | null;
  isDir: boolean;
  children?: FileNode[];
}
export type PreviewKind = "editor" | "image" | "pdf" | "text" | "unsupported";
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
