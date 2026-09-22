import { type ReactElement } from "react";
import { cn } from "../../../lib/utils";
import { parseFileName } from "../utils/fileName";

interface FileNameLabelProps {
  /** Full file name including extension. */
  fileName: string;
  /** Extra classes for the outer element. */
  className?: string;
  /** Extra classes for the muted extension span. */
  extensionClassName?: string;
  /** Overrides the tooltip / accessible name (defaults to the full name). */
  title?: string;
}

/**
 * Read-only file name display shared by the file tree and Open Tabs. The stem
 * renders in the primary text color and every extension — including `.md` and
 * `.markdown` — renders as muted secondary text. The full name is preserved in
 * the tooltip and accessible name.
 */
export function FileNameLabel({
  fileName,
  className,
  extensionClassName,
  title,
}: FileNameLabelProps): ReactElement {
  const { stem, extension } = parseFileName(fileName);
  return (
    <span className={cn("truncate", className)} title={title ?? fileName}>
      {stem}
      {extension && (
        <span className={cn("text-muted-text", extensionClassName)}>
          {extension}
        </span>
      )}
    </span>
  );
}
