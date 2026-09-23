export interface RecentEntry {
  lastOpenedAt: number;
  openCount: number;
}
export interface RecentFilesData {
  version: 1;
  entries: Record<string, RecentEntry>;
}
export interface MaekWorkspaceConfig {
  version: number;
  name: string;
  createdAt: number;
  description?: string;
  [key: string]: unknown;
}
export interface FolderAppearanceData {
  version: 1;
  folders: Record<string, { icon: string; iconColor: string }>;
}
export interface ExplorerSettingsData {
  version: 1;
  /**
   * When true, the file tree shows entries whose name (at any path segment)
   * begins with a dot. Fixed excludes such as `.maek`, `.git`, and
   * `node_modules` stay hidden regardless. Defaults to false when the file is
   * absent.
   */
  showHiddenFiles: boolean;
}
export interface DashboardState {
  config: MaekWorkspaceConfig;
  rawConfig: string | null;
  configExists: boolean;
  configError: string | null;
  tabs: {
    version?: unknown;
    tabs?: unknown[];
    tabGroups?: unknown[];
    [key: string]: unknown;
  } | null;
  tabsError: string | null;
  recents: RecentFilesData;
  recentsError: string | null;
  folderAppearance: FolderAppearanceData;
  folderAppearanceError: string | null;
  explorerSettings: ExplorerSettingsData;
  explorerSettingsError: string | null;
}
