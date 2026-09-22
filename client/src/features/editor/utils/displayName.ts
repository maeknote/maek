import { parseFileName } from "./fileName";

/** Display files without extension */
export function getDisplayName(fileName: string): string {
  return parseFileName(fileName).stem;
}

export function toFileName(
  displayName: string,
  originalFileName: string,
): string {
  const { extension } = parseFileName(originalFileName);
  if (
    extension &&
    !displayName.toLowerCase().endsWith(extension.toLowerCase())
  ) {
    return displayName + extension;
  }
  return displayName;
}
