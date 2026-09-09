import { useCallback, type KeyboardEvent } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import type { TabItem } from "../types";
import { getFrontmatterLineCount } from "../utils/frontmatter";
import { useTabStore } from "../stores/tabStore";
import { PropertiesView } from "./frontmatter/PropertiesView";

interface FrontmatterPanelProps {
  tab: TabItem;
  onSave: () => void;
}

export function FrontmatterPanel({ tab, onSave }: FrontmatterPanelProps) {
  const {
    toggleFrontmatterExpanded,
    updateFrontmatterRaw,
    setFrontmatterViewMode,
  } = useTabStore();
  const lineCount = getFrontmatterLineCount(tab.frontmatter.raw);
  const isInvalid = Boolean(tab.frontmatter.validationError);
  const storedMode = tab.frontmatter.viewMode ?? "properties";
  const viewMode = isInvalid ? "raw" : storedMode;

  const handleToggle = useCallback(() => {
    toggleFrontmatterExpanded(tab.id);
  }, [tab.id, toggleFrontmatterExpanded]);

  const handleSaveKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
      }
    },
    [onSave],
  );

  const handleModeToggle = useCallback(() => {
    setFrontmatterViewMode(tab.id, storedMode === "raw" ? "properties" : "raw");
  }, [tab.id, storedMode, setFrontmatterViewMode]);

  const handleSwitchToRaw = useCallback(() => {
    setFrontmatterViewMode(tab.id, "raw");
  }, [tab.id, setFrontmatterViewMode]);

  return (
    <section className="shrink-0 px-8 pb-1 pt-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={tab.frontmatter.expanded}
          className="flex items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-surface-overlay"
        >
          {tab.frontmatter.expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-tertiary-text" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tertiary-text" />
          )}
          <span
            className={cn(
              "text-xs",
              isInvalid ? "text-red-600 dark:text-red-400" : "text-muted-text",
            )}
          >
            {lineCount} properties
          </span>
        </button>

        {tab.frontmatter.expanded && (
          <ViewModeToggle
            isRaw={viewMode === "raw"}
            onToggle={handleModeToggle}
            disabled={isInvalid}
          />
        )}

        {isInvalid && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            Invalid
          </span>
        )}
      </div>

      {/* Content */}
      {tab.frontmatter.expanded && (
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
      )}
    </section>
  );
}

function ViewModeToggle({
  isRaw,
  onToggle,
  disabled,
}: {
  isRaw: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      title={disabled ? "Fix YAML errors to switch view" : undefined}
      className={cn(
        "frontmatter-mode-switch",
        disabled && "frontmatter-mode-switch--disabled",
      )}
    >
      {isRaw ? "Properties" : "Source"}
    </button>
  );
}
