import { type ReactElement, type ReactNode } from "react";
import type { Tab } from "../../../store";
import { useFileRename } from "./useFileRename";

interface ViewerToolbarProps {
  tab: Tab;
  onRename: (newFileName: string) => Promise<void>;
  /** Right-aligned action buttons (icons). */
  actions?: ReactNode;
}

/**
 * Compact 40px header for non-markdown viewers (HTML, image, PDF, text,
 * unsupported, and CSV). Shows an inline-editable file name that preserves the
 * extension, and icon-only actions. The toolbar is a separate row so it never
 * overlaps the iframe/preview below it.
 */
export function ViewerToolbar({
  tab,
  onRename,
  actions,
}: ViewerToolbarProps): ReactElement {
  const rename = useFileRename({ fileName: tab.name, onRename });

  const lastDotIndex = tab.name.lastIndexOf(".");
  const ext =
    lastDotIndex > 0 && lastDotIndex < tab.name.length - 1
      ? tab.name.slice(lastDotIndex)
      : "";

  return (
    <div className="viewer-toolbar flex items-center gap-2 px-3 shrink-0">
      <div
        className="viewer-toolbar-filename flex items-baseline min-w-0 flex-1"
        title={tab.id}
      >
        {/* The input width tracks its content (via the invisible sizing span)
            so the extension label hugs the name exactly like the editor title. */}
        <span className="relative inline-flex min-w-0 max-w-full">
          <span
            className="invisible whitespace-pre text-sm font-medium px-0"
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
            aria-label="File name"
            className="absolute inset-0 w-full h-full p-0 m-0 border-none text-sm font-medium text-neutral-ink bg-transparent placeholder:text-muted-text disabled:opacity-50 caret-neutral-ink"
            style={{ outline: "none", boxShadow: "none" }}
            placeholder="Untitled"
          />
        </span>
        {ext && (
          <span
            className="text-sm text-muted-text select-none cursor-default shrink-0"
            title={`File extension: ${ext}`}
          >
            {ext}
          </span>
        )}
      </div>
      {actions ? (
        <div className="flex items-center gap-1 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
