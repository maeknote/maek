import { type ReactElement, type ReactNode } from "react";
import type { Tab } from "@renderer/features/workspace";
import { parseFileName } from "../utils/fileName";
import { useFileRename } from "./useFileRename";

interface ViewerToolbarProps {
  tab: Pick<Tab, "id" | "name">;
  onRename: (newFileName: string) => Promise<void>;
  /** Fixed type label for extensionless workspace views. */
  typeLabel?: string;
  nameLabel?: string;
  /** Right-aligned action buttons (icons). */
  actions?: ReactNode;
}

/**
 * Shared 48px header for file viewers and databases. Shows an inline-editable
 * name with either a fixed file extension or a workspace-view type label.
 * The toolbar is a separate row so it never overlaps the preview below it.
 */
export function ViewerToolbar({
  tab,
  onRename,
  typeLabel,
  nameLabel = "File name",
  actions,
}: ViewerToolbarProps): ReactElement {
  const rename = useFileRename({
    fileName: tab.name,
    onRename,
    preserveExtension: !typeLabel,
  });

  const ext = typeLabel ? "" : parseFileName(tab.name).extension;

  return (
    <div className="content-header flex items-center gap-2 px-3 shrink-0">
      <div
        className="content-header-title flex items-baseline min-w-0 flex-1"
        title={tab.id}
      >
        {/* The input width tracks its content (via the invisible sizing span)
            so the extension label hugs the file name. */}
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
            aria-label={nameLabel}
            className="absolute inset-0 w-full h-full p-0 m-0 border-none text-sm font-medium text-neutral-ink bg-transparent placeholder:text-muted-text disabled:opacity-50 caret-neutral-ink"
            style={{ outline: "none", boxShadow: "none" }}
            placeholder="Untitled"
          />
        </span>
        {ext && (
          <span
            className="text-sm text-muted-text select-none cursor-default shrink-0"
            title={tab.name}
          >
            {ext}
          </span>
        )}
        {typeLabel && (
          <span className="ml-2 text-sm text-muted-text select-none cursor-default shrink-0">
            {typeLabel}
          </span>
        )}
      </div>
      {actions ? (
        <div className="flex items-center gap-1 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
