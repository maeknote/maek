import { useCallback, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";
import type { TabItem } from "../types";
import { useTabStore } from "../stores/tabStore";
import { PropertiesView } from "./frontmatter/PropertiesView";

interface FrontmatterPanelProps {
  tab: TabItem;
  onSave: () => void;
}

export function FrontmatterPanel({ tab, onSave }: FrontmatterPanelProps) {
  const { updateFrontmatterRaw, setFrontmatterViewMode } = useTabStore();
  const isInvalid = Boolean(tab.frontmatter.validationError);
  const storedMode = tab.frontmatter.viewMode ?? "properties";
  const viewMode = isInvalid ? "raw" : storedMode;

  const handleSaveKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  const handleSwitchToRaw = useCallback(() => {
    setFrontmatterViewMode(tab.id, "raw");
  }, [tab.id, setFrontmatterViewMode]);

  if (!tab.frontmatter.expanded) return null;

  return (
    <section className="shrink-0 px-8 pb-1 pt-2">
      <div className="mt-1">
        {viewMode === "properties" ? (
          <PropertiesView
            tab={tab}
            onSave={onSave}
            onSwitchToRaw={handleSwitchToRaw}
          />
        ) : (
          <div className="pb-2">
            <textarea
              value={tab.frontmatter.raw ?? ""}
              onChange={(event) =>
                updateFrontmatterRaw(tab.id, event.target.value)
              }
              onKeyDown={handleSaveKeyDown}
              spellCheck={false}
              wrap="soft"
              className="min-h-[180px] w-full resize-y rounded-lg border border-[var(--color-border-subtle)] bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-neutral-ink outline-none transition-colors focus:border-[var(--color-input-border-focus)]"
            />

            {tab.frontmatter.validationError && (
              <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{tab.frontmatter.validationError}</span>
              </div>
            )}
          </div>
        )}

        {/* Subtle separator between frontmatter and body */}
        <div className="border-b border-[var(--color-border-subtle)]" />
      </div>
    </section>
  );
}
