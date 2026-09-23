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
          {actions}
        </>
      }
    />
  );
}
