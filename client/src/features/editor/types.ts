import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";

export interface EditorContent {
  type: "doc";
  content: JSONContent[];
}

export interface EditorState {
  isDirty: boolean;
  content: string;
}

export interface EditorPaneProps {
  tabId: string;
  initialContent: string;
  onUpdate?: (content: string) => void;
  onSave?: (content: string) => void;
}

export type PreviewFormat =
  "pdf" | "docx" | "csv" | "xlsx" | "pptx" | "image" | "text" | "code" | "html";
export type TabViewKind =
  | "editor"
  | "spreadsheet"
  | "preview"
  | "database"
  | "meeting"
  | "workspace-settings"
  | "kanban"
  | "unsupported";
export type LineEnding = "\n" | "\r\n";

export type { Editor, JSONContent };

export type FrontmatterViewMode = "raw" | "properties";

export interface FrontmatterState {
  hasFrontmatter: boolean;
  raw: string | null;
  savedRaw: string | null;
  expanded: boolean;
  validationError: string | null;
  lineEnding: LineEnding;
  viewMode: FrontmatterViewMode;
}

export interface TabOpenPayload {
  bodyContent: string;
  frontmatter: FrontmatterState;
  viewKind: TabViewKind;
  previewFormat: PreviewFormat | null;
  /** Raw file content as read from disk (frontmatter + body), preserved verbatim. */
  diskFileContent: string;
  /** Absolute note.md path for folder-backed meeting tabs. */
  meetingNotePath?: string;
}

// Tab types
export interface TabItem {
  /** Unique identifier - absolute file path */
  id: string;
  /** File name (including extension) */
  name: string;
  /** Parent folder name (for disambiguation when duplicate names exist) */
  parentName: string;
  /** Current editor body content */
  bodyContent: string;
  /** Body content at last save */
  savedBodyContent: string;
  /** YAML front matter state */
  frontmatter: FrontmatterState;
  /** View mode for this tab */
  viewKind: TabViewKind;
  /** Preview format when this tab is a read-only preview */
  previewFormat: PreviewFormat | null;
  /** Increments when a preview should reload its source bytes */
  previewNonce: number;
  /** Whether this is a temporary tab that is replaced by the next ephemeral open */
  isEphemeral: boolean;
  /** Whether this tab is opened inside a popup (center peek) and should be hidden from the tab bar */
  isPopup?: boolean;
  /** Raw file content as read from disk (frontmatter + body). Source of truth for the on-disk file. */
  diskFileContent: string;
  /** Absolute note.md path for folder-backed meeting tabs. */
  meetingNotePath?: string;
  /** Workspace-relative folder path for kanban tabs. */
  kanbanFolderPath?: string;
  /** Workspace-relative folder path for database tabs. */
  databaseFolderPath?: string;
  /**
   * Body content after Tiptap parse → re-serialize round-trip, captured at mount or after
   * a disk-side change is applied. Empty string when not yet computed.
   * Used to distinguish "user actually edited" from "Tiptap normalized the markdown".
   */
  diskNormalizedBody: string;
}

export interface TabGroup {
  id: string;
  title: string;
  color: string;
  tabIds: string[];
  collapsed: boolean;
}

export type EditorSplitLayout =
  "single" | "columns-2" | "columns-3" | "rows-2" | "rows-3" | "grid-2x2";

export interface EditorSplitPane {
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

// Table types
export interface TableInfo {
  pos: number;
  node: unknown;
  rowCount: number;
  colCount: number;
  rect: DOMRect | null;
}

export interface GripPosition {
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface RowGripData {
  rowIndex: number;
  isHeader: boolean;
  top: number;
  height: number;
}

export interface ColumnGripData {
  colIndex: number;
  left: number;
  width: number;
}

export interface TableOverlayProps {
  editor: Editor | null;
}

export interface GripProps {
  index: number;
  isHeader?: boolean;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  onMenuOpen: (index: number, position: { x: number; y: number }) => void;
}

export interface PhantomTriggerProps {
  type: "row" | "column";
  onClick: () => void;
}

export interface TableContextMenuProps {
  type: "row" | "column";
  position: { x: number; y: number };
  targetIndex: number;
  onAction: (action: TableMenuAction) => void;
  onClose: () => void;
}

export type TableMenuAction =
  | "addRowAbove"
  | "addRowBelow"
  | "deleteRow"
  | "addColumnLeft"
  | "addColumnRight"
  | "deleteColumn";
