import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useDeferredValue,
} from "react";
import { createPortal } from "react-dom";
import { FileText, Search, Table } from "lucide-react";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import { useStore } from "../../../../store";
import { useNotePickerStore } from "../../stores/notePickerStore";
import { useTabStore } from "../../stores/tabStore";
import { getDisplayName } from "../../utils/displayName";
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
} from "../../../search";
import type { FileNode } from "@shared/types";

export function NotePicker(): React.ReactNode {
  const { isOpen, position, onSelect, close } = useNotePickerStore();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const files = useStore((s) => s.nodes);
  const rootPath = ".";

  const getRelativePath = useCallback(
    (file: FileNode): string => {
      if (!rootPath || !file.parent) return "";
      if (file.parent === rootPath) return "";
      return file.parent.startsWith(rootPath + "/")
        ? file.parent.slice(rootPath.length + 1)
        : file.parent;
    },
    [rootPath],
  );

  const activeTabId = useTabStore((s) => s.activeTabId);
  // Exclude the active note from link targets.
  const linkableFiles = useMemo(() => {
    return files.filter(
      (f) => !f.isDir && f.name.endsWith(".md") && f.id !== activeTabId,
    );
  }, [files, activeTabId]);

  const fuse = useMemo(() => {
    const indexed = indexFiles(linkableFiles, getRelativePath);
    return createFuse(indexed);
  }, [linkableFiles, getRelativePath]);

  const recentEntries = useRecentFilesStore((s) => s.entries);

  const results = useMemo((): RankedResult[] => {
    if (!deferredQuery.trim()) {
      const topRecents = topRecentsFrom(
        recentEntries,
        SEARCH_TUNING.emptyStateRecentsLimit,
      );
      const byId = new Map(linkableFiles.map((f) => [f.id, f]));
      const recentResults: RankedResult[] = [];
      const seen = new Set<string>();
      for (const r of topRecents) {
        const file = byId.get(r.fileId);
        if (!file) continue;
        recentResults.push({ file, score: 0, matches: [] });
        seen.add(file.id);
      }
      const remainder = linkableFiles.filter((f) => !seen.has(f.id));
      return [
        ...recentResults,
        ...remainder.map((file) => ({ file, score: 0, matches: [] as [] })),
      ];
    }
    return scoreFiles(fuse, deferredQuery, (fileId) =>
      recencyScoreFor(recentEntries[fileId]),
    );
  }, [fuse, linkableFiles, deferredQuery, recentEntries]);

  // Reset state when opening
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setFocusedIndex(0);
    const rafId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(rafId);
  }, [isOpen]);

  // Initialize menuPos from raw position, then refine with floating-ui
  useEffect(() => {
    if (!isOpen) return;
    setMenuPos(position);

    if (!containerRef.current) return;
    const virtualEl = {
      getBoundingClientRect: () => new DOMRect(position.x, position.y, 0, 0),
    };

    void computePosition(virtualEl, containerRef.current, {
      placement: "bottom-start",
      middleware: [offset(4), flip({ padding: 16 }), shift({ padding: 16 })],
    }).then(({ x, y }) => {
      setMenuPos({ x, y });
    });
  }, [isOpen, position]);

  // Click-outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent): void => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };

    // Delay to avoid the triggering click from immediately closing
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, close]);

  const handleSelect = useCallback(
    (file: FileNode) => {
      onSelect?.(file);
      close();
    },
    [onSelect, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (
        e.key === "Enter" &&
        focusedIndex >= 0 &&
        focusedIndex < results.length
      ) {
        e.preventDefault();
        handleSelect(results[focusedIndex]!.file);
      }
    },
    [results, focusedIndex, handleSelect, close],
  );

  // Reset focused index when query changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [query]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-note-item]");
    items[focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="maek-note-picker"
      style={{
        position: "fixed",
        left: `${menuPos.x}px`,
        top: `${menuPos.y}px`,
        zIndex: 1100,
      }}
    >
      {/* Search input */}
      <div className="maek-note-picker-header">
        <Search className="maek-note-picker-search-icon" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search notes..."
          className="maek-note-picker-input"
          spellCheck={false}
        />
      </div>

      {/* File list */}
      <div ref={listRef} className="maek-note-picker-list">
        {results.length === 0 ? (
          <div className="maek-note-picker-empty">
            {query
              ? "No notes or databases found"
              : "No notes or databases in workspace"}
          </div>
        ) : (
          results.map((result, index) => {
            const { file, matches } = result;
            const relativePath = getRelativePath(file);
            const isFocused = index === focusedIndex;
            const nameIndices = getNameMatchIndices(matches);
            const pathIndices = getPathMatchIndices(matches, relativePath);
            const Icon = file.isDatabase ? Table : FileText;
            const displayName = file.isDatabase
              ? file.name
              : getDisplayName(file.name);
            return (
              <button
                key={file.id}
                data-note-item
                onClick={() => handleSelect(file)}
                className={`maek-note-picker-item ${isFocused ? "focused" : ""}`}
              >
                <Icon className="maek-note-picker-item-icon" />
                <div className="maek-note-picker-item-text">
                  <span className="maek-note-picker-item-name">
                    <HighlightMatch text={displayName} indices={nameIndices} />
                  </span>
                  {relativePath && (
                    <span className="maek-note-picker-item-path">
                      <HighlightMatch
                        text={relativePath}
                        indices={pathIndices}
                      />
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
