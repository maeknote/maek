import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, Copy, ListTree } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { useToast } from "@renderer/shared/components";
import type { TabItem } from "../types";
import { getTabFileContent, isEditableMarkdownTab } from "../utils/frontmatter";
import { useTabStore } from "../stores/tabStore";
import { ViewerToolbar } from "./ViewerToolbar";

interface TitleBarProps {
  tab: TabItem;
  onRename: (newFileName: string) => Promise<void>;
  actions?: ReactNode;
}

export function TitleBar({ tab, onRename, actions }: TitleBarProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToast();
  const { setFrontmatterViewMode, toggleFrontmatterExpanded } = useTabStore();
  const frontmatterMode = tab.frontmatter.viewMode ?? "properties";
  const hasFrontmatter =
    isEditableMarkdownTab(tab) && tab.frontmatter.hasFrontmatter;
  const isFrontmatterInvalid = Boolean(tab.frontmatter.validationError);

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

  return (
    <ViewerToolbar
      tab={tab}
      onRename={onRename}
      actions={
        <>
          {isEditableMarkdownTab(tab) && (
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="icon-button"
              aria-label="Copy note"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
          {hasFrontmatter && (
            <>
              <button
                type="button"
                onClick={() => toggleFrontmatterExpanded(tab.id)}
                className={cn(
                  "icon-button",
                  tab.frontmatter.expanded && "bg-surface-overlay",
                )}
                aria-label={
                  tab.frontmatter.expanded
                    ? "Hide properties"
                    : "Show properties"
                }
                aria-pressed={tab.frontmatter.expanded}
              >
                <ListTree size={14} />
              </button>
              {tab.frontmatter.expanded && !isFrontmatterInvalid && (
                <button
                  type="button"
                  onClick={() =>
                    setFrontmatterViewMode(
                      tab.id,
                      frontmatterMode === "raw" ? "properties" : "raw",
                    )
                  }
                  className="frontmatter-mode-switch"
                >
                  {frontmatterMode === "raw" ? "Properties" : "Source"}
                </button>
              )}
            </>
          )}
          {actions}
        </>
      }
    />
  );
}
