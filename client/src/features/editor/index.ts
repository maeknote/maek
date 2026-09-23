export { FilePicker } from "./components/FilePicker";
export { NotePicker } from "./components/note-picker/NotePicker";
export { SplitSeparator } from "./components/SplitSeparator";
export { FilePane } from "./components/FilePane";
export { ViewerToolbar } from "./components/ViewerToolbar";
export { FileNameLabel } from "./components/FileNameLabel";
export {
  getTabFileContent,
  isTabDirty,
  splitFrontmatter,
  validateFrontmatterYaml,
} from "./utils/frontmatter";
export { paneWidths } from "./utils/splitLayout";
export { getDisplayName } from "./utils/displayName";
export type { TabItem, FrontmatterViewMode } from "./types";
