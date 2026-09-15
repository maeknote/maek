import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import { getDisplayName, toFileName } from "../utils/displayName";
import { useToast } from "@renderer/shared/components";
import type { TabItem } from "../types";
import { getTabFileContent, isEditableMarkdownTab } from "../utils/frontmatter";

interface TitleBarProps {
  tab: TabItem;
  onRename: (newFileName: string) => Promise<void>;
  actions?: ReactNode;
}

export function TitleBar({ tab, onRename, actions }: TitleBarProps): ReactElement {
  const displayName = getDisplayName(tab.name);
  // Markdown editor tabs and database table tabs are both renamable from here.
  const isEditableTitle =
    isEditableMarkdownTab(tab) || tab.viewKind === "database";
  const [title, setTitle] = useState(displayName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();

  // Sync local state when tab changes (e.g. switching tabs)
  useEffect(() => {
    setTitle(getDisplayName(tab.name));
  }, [tab.name]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();

    if (!isEditableTitle) {
      setTitle(displayName);
      return;
    }

    // Empty or unchanged → revert
    if (!trimmed || trimmed === displayName) {
      setTitle(displayName);
      return;
    }

    const newFileName = toFileName(trimmed, tab.name);

    setIsSubmitting(true);
    try {
      await onRename(newFileName);
    } catch {
      // Revert on error
      setTitle(displayName);
    } finally {
      setIsSubmitting(false);
    }
  }, [title, displayName, tab.name, onRename, isEditableTitle]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputRef.current?.blur();
      } else if (e.key === "Escape") {
        setTitle(displayName);
        inputRef.current?.blur();
      }
    },
    [displayName],
  );

  const handleCopyMarkdown = useCallback(async () => {
    if (!isEditableMarkdownTab(tab)) return;
    try {
      await navigator.clipboard.writeText(getTabFileContent(tab));
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Failed to copy file content", "error");
    }
  }, [tab, showToast]);

  return (
    <div className="px-8 pt-6 pb-3 shrink-0">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          disabled={isSubmitting || !isEditableTitle}
          spellCheck={false}
          className="flex-1 min-w-0 text-3xl font-bold text-neutral-ink bg-transparent placeholder:text-muted-text disabled:opacity-50 caret-neutral-ink"
          style={{ outline: "none", boxShadow: "none" }}
          placeholder="Untitled"
        />
        {isEditableMarkdownTab(tab) && (
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="maek-title-copy-btn h-8 w-8 rounded-md hover:bg-surface-overlay transition-colors text-muted-text hover:text-neutral-ink flex items-center justify-center shrink-0"
            aria-label="Copy note"
            title="Copy note"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {actions}
      </div>
    </div>
  );
}
