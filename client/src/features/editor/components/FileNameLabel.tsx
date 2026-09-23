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
  /** Fixed label for an extensionless view such as a database. */
  typeLabel?: string;
}

/**
 * Read-only name display shared by the file tree and Open Tabs. File extensions
 * and database type labels render as muted secondary text. The full label is
 * preserved in the tooltip.
 */
export function FileNameLabel({
  fileName,
  className,
  extensionClassName,
  title,
  typeLabel,
}: FileNameLabelProps): ReactElement {
  if (typeLabel)
    return (
      <span
        className={cn("inline-flex min-w-0 items-baseline", className)}
        title={title ?? `${fileName} ${typeLabel}`}
      >
        <span className="truncate">{fileName}</span>
        <span className={cn("ml-2 shrink-0 text-muted-text", extensionClassName)}>
          {typeLabel}
        </span>
      </span>
    );
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
