/** Parsed parts of a file name. Casing is always preserved. */
export interface FileNameParts {
  /** The file name without its trailing extension. */
  stem: string;
  /** The trailing extension including the leading dot, or "" when there is
   *  none (dotfiles like ".env", extensionless names, trailing-dot names). */
  extension: string;
}

/**
 * Split a file name into its stem and extension.
 *
 * Rules (casing preserved throughout):
 * - `note.md` → `{ stem: "note", extension: ".md" }`
 * - `archive.tar.gz` → `{ stem: "archive.tar", extension: ".gz" }` (last dot)
 * - `.env` → `{ stem: ".env", extension: "" }` (leading dot is not an ext)
 * - `README` → `{ stem: "README", extension: "" }` (no dot)
 * - `name.` → `{ stem: "name.", extension: "" }` (trailing dot is not an ext)
 */
export function parseFileName(fileName: string): FileNameParts {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) {
    return {
      stem: fileName.slice(0, lastDotIndex),
      extension: fileName.slice(lastDotIndex),
    };
  }
  return { stem: fileName, extension: "" };
}
