export {
  SEARCH_TUNING,
  indexFiles,
  createFuse,
  scoreFiles,
  getNameMatchIndices,
  getPathMatchIndices,
} from "./utils/fuzzySearch";
export type { IndexedFile, RankedResult } from "./utils/fuzzySearch";
export { HighlightMatch } from "./utils/highlightMatch";
export {
  useRecentFilesStore,
  recencyScoreFor,
  topRecentsFrom,
} from "./stores/recentFilesStore";
