import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { Search, File, FileCode, X } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { useStore } from "@renderer/features/workspace";
import { getDisplayName } from "../utils/displayName";
import {
  HighlightMatch,
  SEARCH_TUNING,
  createFuse,
  getNameMatchIndices,
  getPathMatchIndices,
  indexFiles,
  recencyScoreFor,
  scoreFiles,
  topRecentsFrom,
  useRecentFilesStore,
  type RankedResult,
} from "../../search";
import type { FileNode } from "@shared/workspace";

interface FilePickerProps {
  onClose: () => void;
  onSelect?: (file: FileNode) => Promise<void> | void;
}

const ROW_HEIGHT = 52;
const VIEWPORT_HEIGHT = 340;
const OVERSCAN = 4;

export function FilePicker({ onClose, onSelect }: FilePickerProps): ReactElement {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const nodes = useStore((s) => s.nodes);
  const files = useMemo(() => nodes.filter((n) => !n.isDir), [nodes]);
  const rootPath = ".";
  const recentEntries = useRecentFilesStore((s) => s.entries);

  // Auto-focus search input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleQueryChange = useCallback((value: string): void => {
    setQuery(value);
    setFocusedIndex(-1);
  }, []);

  // Get relative path for display
  const getRelativePath = useCallback(
    (file: FileNode): string => {
      if (!rootPath || !file.parent) return "";
      const relative = file.parent.startsWith(rootPath + "/")
        ? file.parent.slice(rootPath.length + 1)
        : file.parent === rootPath
          ? ""
          : file.parent;
      return relative;
    },
    [rootPath],
  );

  // Build Fuse index once per `files` change
  const fuse = useMemo(() => {
    const indexed = indexFiles(files, getRelativePath);
    return createFuse(indexed);
  }, [files, getRelativePath]);

  // Rank results against the current query (deferred to keep input responsive)
  const results = useMemo((): RankedResult[] => {
    if (!deferredQuery.trim()) {
      const topRecents = topRecentsFrom(
        recentEntries,
        SEARCH_TUNING.emptyStateRecentsLimit,
      );
      const byId = new Map(files.map((f) => [f.id, f]));
      const recentResults: RankedResult[] = [];
      const seen = new Set<string>();
      for (const r of topRecents) {
        const file = byId.get(r.fileId);
        if (!file) continue;
        recentResults.push({ file, score: 0, matches: [] });
        seen.add(file.id);
      }
      const remainder = files.filter((f) => !seen.has(f.id));
      return [
        ...recentResults,
        ...remainder.map((file) => ({ file, score: 0, matches: [] as [] })),
      ];
    }
    return scoreFiles(fuse, deferredQuery, (fileId) =>
      recencyScoreFor(recentEntries[fileId]),
    );
  }, [fuse, files, deferredQuery, recentEntries]);

  const handleSelect = useCallback(
    async (file: FileNode) => {
      if (onSelect) await onSelect(file);
      else await useStore.getState().openFile(file.id);
      onClose();
    },
    [onClose],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < results.length - 1 ? prev + 1 : prev;
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev > 0 ? prev - 1 : -1;
          return next;
        });
      } else if (
        e.key === "Enter" &&
        focusedIndex >= 0 &&
        focusedIndex < results.length
      ) {
        e.preventDefault();
        handleSelect(results[focusedIndex]!.file);
      }
    },
    [results, focusedIndex, handleSelect, onClose],
  );

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [deferredQuery]);

  // Keyboard navigation also reveals rows outside the mounted window.
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const list = listRef.current;
    const top = focusedIndex * ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight)
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
    setScrollTop(list.scrollTop);
  }, [focusedIndex]);

  const first = Math.max(0, Math.min(results.length - 1, Math.floor(scrollTop / ROW_HEIGHT)) - OVERSCAN);
  const last = Math.min(results.length, first + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] [&_*:focus-visible]:outline-none [&_*:focus]:outline-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-[480px] max-h-[400px] flex flex-col overflow-hidden glass-modal">
        {/* Header with search + close */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--glass-border)]">
          <Search className="w-4 h-4 text-muted-text shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files..."
            aria-label="Search files"
            className="flex-1 text-sm text-neutral-ink bg-transparent placeholder:text-muted-text"
            style={{ outline: "none", boxShadow: "none", border: "none" }}
            spellCheck={false}
          />
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-full text-muted-text hover:text-neutral-ink hover:bg-surface-overlay transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* File list */}
        <div
          ref={listRef}
          role="listbox"
          aria-label="Files"
          onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
          className="flex-1 overflow-y-auto"
          style={{ maxHeight: VIEWPORT_HEIGHT }}
        >
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-text">
              {query ? "No results found" : "No files"}
            </div>
          ) : (
            <div style={{ paddingTop: first * ROW_HEIGHT, paddingBottom: (results.length - last) * ROW_HEIGHT }}>
              {results.slice(first, last).map((result, offset) => {
                const index = first + offset;
                const { file, matches } = result;
                const relativePath = getRelativePath(file);
                const isFocused = index === focusedIndex;
                const displayName = file.isDir
                  ? file.name
                  : getDisplayName(file.name);
                const nameIndices = getNameMatchIndices(matches);
                const pathIndices = getPathMatchIndices(matches, relativePath);
                const Icon = /\.html$/i.test(file.name) ? FileCode : File;
                return (
                  <button
                    key={file.id}
                    data-file-item
                    role="option"
                    aria-selected={isFocused}
                    aria-posinset={index + 1}
                    aria-setsize={results.length}
                    style={{ height: ROW_HEIGHT }}
                    onClick={() => handleSelect(file)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                      isFocused
                        ? "bg-surface-overlay-strong"
                        : "hover:bg-surface-overlay",
                    )}
                  >
                    <Icon className="w-4 h-4 text-muted-text shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-neutral-ink truncate">
                        <HighlightMatch
                          text={displayName}
                          indices={nameIndices}
                        />
                      </div>
                      {relativePath && (
                        <div className="text-xs text-muted-text truncate">
                          <HighlightMatch
                            text={relativePath}
                            indices={pathIndices}
                          />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
