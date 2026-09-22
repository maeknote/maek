import { type ReactElement } from "react";
import { useStore, type Tab } from "../../../store";
import { cn } from "../../../lib/utils";
import { FilePane } from "./FilePane";
import { paneWidths } from "../utils/splitLayout";

/** File-backed view kinds render through the FilePane cache. Other view kinds
 *  (workspace-settings, kanban, database) are non-file surfaces rendered
 *  directly by App. */
export function isFileBackedTab(tab: Tab): boolean {
  return (
    tab.viewKind === "editor" ||
    tab.viewKind === "spreadsheet" ||
    tab.viewKind === "preview" ||
    tab.viewKind === "unsupported"
  );
}

/**
 * Views whose native internal state must survive a tab switch and therefore
 * stay mounted while their tab is open: browser PDF viewers, HTML iframes, CSV
 * grids, and text/image scrollers.
 *
 * Markdown editors are intentionally excluded — their scroll position is
 * preserved by the existing `scrollPositions` persistence, so a single active
 * editor instance is mounted at a time (keeping the DOM to one `.tiptap`).
 */
function shouldPersistView(tab: Tab): boolean {
  return tab.viewKind === "spreadsheet" || tab.viewKind === "preview" || tab.viewKind === "unsupported";
}

interface FilePaneHostProps {
  /** The tab shown in the left (or single) pane, or null when the active view
   *  is a non-file surface (all cached file panes stay hidden). */
  leftTab: Tab | null;
  /** The tab shown in the right pane, when split. */
  rightTab: Tab | null;
  /** Left pane fractional width (0..1). Ignored when not split. */
  ratio: number;
  onOpenToSide: () => void;
  onSaveCopy: (tab: Tab) => void;
  /** Optional separator element rendered between the two panes when split. */
  separator?: ReactElement | null;
}

/**
 * Persistent runtime view cache for file-backed tabs.
 *
 * Every open, file-backed tab is mounted exactly once and kept mounted while it
 * stays open, so the native internal state of the view (browser PDF viewer,
 * HTML iframe, CSV grid, text/image scroller) survives a tab switch. Inactive
 * panes are hidden with absolute positioning, `visibility: hidden`, and
 * disabled pointer events rather than unmounted. A view is only removed when
 * its tab closes or the workspace changes (both remove it from `state.tabs`).
 *
 * Reload, a file-generation change, or an HTML reload intentionally recreate
 * only the affected view (FilePane keys its body on `tab.generation` /
 * `tab.previewNonce`), resetting that view's position while leaving the others
 * untouched.
 *
 * In split mode only the two currently assigned pane views receive input; all
 * other cached views remain hidden.
 */
export function FilePaneHost({
  leftTab,
  rightTab,
  ratio,
  onOpenToSide,
  onSaveCopy,
  separator,
}: FilePaneHostProps): ReactElement {
  const tabs = useStore((s) => s.tabs);
  const isSplit = Boolean(leftTab && rightTab);

  // Mount the tabs whose views must persist (PDF/HTML/CSV/text/image), plus the
  // currently active left/right tabs (which may be Markdown editors that are
  // otherwise mounted only while active). De-duplicate by tab id, preserving
  // tab order for a stable DOM.
  const mounted: Tab[] = tabs.filter(shouldPersistView);
  for (const tab of [leftTab, rightTab]) {
    if (tab && isFileBackedTab(tab) && !mounted.some((t) => t.id === tab.id))
      mounted.push(tab);
  }

  const widths = paneWidths(ratio);
  const leftWidth = isSplit ? widths.left : "100%";
  const rightWidth = isSplit ? widths.right : "0%";

  return (
    <div className="flex-1 min-h-0 relative flex overflow-hidden">
      {mounted.map((tab) => {
        const pane =
          leftTab && tab.id === leftTab.id
            ? "left"
            : rightTab && tab.id === rightTab.id
              ? "right"
              : null;
        const active = pane !== null;
        const width = pane === "left" ? leftWidth : pane === "right" ? rightWidth : "100%";
        return (
          <div
            key={tab.id}
            data-file-pane-slot={tab.id}
            data-active={active ? "true" : "false"}
            aria-hidden={active ? undefined : true}
            className={cn(
              "min-h-0 flex flex-col",
              active
                ? "relative order-none"
                : "absolute inset-0 invisible pointer-events-none",
            )}
            style={{
              width,
              // Keep panes ordered left-to-right when both are active.
              order: pane === "left" ? 0 : pane === "right" ? 2 : 0,
            }}
          >
            <FilePane
              pane={pane ?? "left"}
              tab={tab}
              isSplit={isSplit}
              onOpenToSide={onOpenToSide}
              onSaveCopy={onSaveCopy}
            />
          </div>
        );
      })}
      {isSplit && separator ? (
        <div className="flex shrink-0" style={{ order: 1 }}>
          {separator}
        </div>
      ) : null}
    </div>
  );
}
