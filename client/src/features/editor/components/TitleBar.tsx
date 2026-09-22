import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "@renderer/shared/components";
import type { TabItem } from "../types";
import { getTabFileContent, isEditableMarkdownTab } from "../utils/frontmatter";
import { parseFileName } from "../utils/fileName";
import { useFileRename } from "./useFileRename";

interface TitleBarProps {
  tab: TabItem;
  onRename: (newFileName: string) => Promise<void>;
  actions?: ReactNode;
}

export function TitleBar({ tab, onRename, actions }: TitleBarProps): ReactElement {
  const rename = useFileRename({ fileName: tab.name, onRename });
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

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

  const { extension: ext } = parseFileName(tab.name);
  const showExtension = ext.length > 0;

  return (
    <div className="px-8 pt-6 pb-3 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 flex items-center">
          <div className="relative flex max-w-full min-w-0">
            <span
              className="invisible whitespace-pre text-3xl font-bold overflow-hidden pointer-events-none px-0"
              aria-hidden="true"
            >
              {rename.value || "Untitled"}
            </span>
            <input
              ref={rename.inputRef}
              type="text"
              value={rename.value}
              onChange={(e) => rename.onChange(e.target.value)}
              onBlur={rename.onBlur}
              onKeyDown={rename.onKeyDown}
              disabled={rename.isSubmitting}
              spellCheck={false}
              className="absolute inset-0 w-full h-full p-0 m-0 border-none text-3xl font-bold text-neutral-ink bg-transparent placeholder:text-muted-text disabled:opacity-50 caret-neutral-ink"
              style={{ outline: "none", boxShadow: "none" }}
              placeholder="Untitled"
            />
          </div>
          {showExtension && (
            <span
              className="text-3xl font-bold text-muted-text select-none cursor-default shrink-0"
              title={tab.name}
            >
              {ext}
            </span>
          )}
        </div>
        {isEditableMarkdownTab(tab) && (
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="maek-title-copy-btn h-8 w-8 rounded-md hover:bg-surface-overlay transition-colors text-muted-text hover:text-neutral-ink flex items-center justify-center shrink-0"
            aria-label="Copy note"
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
