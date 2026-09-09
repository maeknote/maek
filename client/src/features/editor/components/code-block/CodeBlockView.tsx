import React, { useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Copy, Check } from "lucide-react";
import { FloatingMenu, MenuItem } from "@renderer/shared/components";

const LANGUAGES = [
  "arduino",
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "go",
  "graphql",
  "ini",
  "java",
  "javascript",
  "json",
  "kotlin",
  "less",
  "lua",
  "makefile",
  "markdown",
  "objectivec",
  "perl",
  "php",
  "php-template",
  "plaintext",
  "python",
  "python-repl",
  "r",
  "ruby",
  "rust",
  "scss",
  "shell",
  "sql",
  "swift",
  "typescript",
  "vbnet",
  "wasm",
  "xml",
  "yaml",
];

export function CodeBlockView({
  node,
  updateAttributes,
}: NodeViewProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const langBtnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const language = node.attrs.language || "plaintext";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(node.textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [node]);

  const handleLangClick = useCallback(() => {
    if (isLangMenuOpen) {
      setIsLangMenuOpen(false);
      return;
    }
    const rect = langBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPosition({ x: rect.left, y: rect.bottom });
    }
    setSearch("");
    const currentIndex = LANGUAGES.indexOf(language);
    setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
    setIsLangMenuOpen(true);
  }, [isLangMenuOpen, language]);

  const handleCloseMenu = useCallback(() => {
    setIsLangMenuOpen(false);
  }, []);

  const filteredLanguages = search
    ? LANGUAGES.filter((lang) => lang.includes(search.toLowerCase()))
    : LANGUAGES;

  const handleSelectLanguage = useCallback(
    (lang: string) => {
      updateAttributes({ language: lang });
      setIsLangMenuOpen(false);
    },
    [updateAttributes],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, filteredLanguages.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredLanguages[selectedIndex]) {
          handleSelectLanguage(filteredLanguages[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCloseMenu();
      }
    },
    [filteredLanguages, selectedIndex, handleSelectLanguage, handleCloseMenu],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setSelectedIndex(0);
    },
    [],
  );

  // Scroll selected item into view on open and keyboard navigation
  useEffect(() => {
    if (!isLangMenuOpen || !listRef.current) return;
    const rafId = requestAnimationFrame(() => {
      if (!listRef.current) return;
      const items = listRef.current.querySelectorAll('[role="menuitem"]');
      const selectedItem = items[selectedIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [isLangMenuOpen, selectedIndex]);

  return (
    <NodeViewWrapper as="div" className="tiptap-code-block">
      <div className="code-block-header" contentEditable={false}>
        <button
          ref={langBtnRef}
          className="code-block-lang"
          onClick={handleLangClick}
          type="button"
        >
          {language}
        </button>
        <button
          className="code-block-copy-btn"
          onClick={handleCopy}
          type="button"
          aria-label={copied ? "Copied" : "Copy"}
          data-tooltip={copied ? "Copied" : "Copy"}
        >
          {copied ? (
            <Check className="w-3 h-3" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>

      <FloatingMenu
        isOpen={isLangMenuOpen}
        position={menuPosition}
        onClose={handleCloseMenu}
        anchorRef={langBtnRef}
        minWidth={180}
      >
        <div className="code-block-lang-dropdown" onKeyDown={handleKeyDown}>
          <input
            ref={inputRef}
            className="code-block-lang-search"
            type="text"
            placeholder="Search language..."
            value={search}
            onChange={handleSearchChange}
            autoFocus
          />
          <div ref={listRef} className="code-block-lang-list">
            {filteredLanguages.map((lang, index) => (
              <MenuItem
                key={lang}
                label={lang}
                selected={index === selectedIndex}
                onClick={() => handleSelectLanguage(lang)}
              />
            ))}
            {filteredLanguages.length === 0 && (
              <div className="code-block-lang-empty">No matching language</div>
            )}
          </div>
        </div>
      </FloatingMenu>

      <NodeViewContent as="div" className="code-block-content" />
    </NodeViewWrapper>
  );
}
