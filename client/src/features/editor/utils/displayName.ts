/** Display .md files without extension, keep others as-is */
export function getDisplayName(fileName: string): string {
  if (fileName.toLowerCase().endsWith(".md") && fileName.length > 3) {
    return fileName.slice(0, -3);
  }
  return fileName;
}

/** Convert edited display name back to actual file name (based on original) */
export function toFileName(
  displayName: string,
  originalFileName: string,
): string {
  if (
    originalFileName.toLowerCase().endsWith(".md") &&
    originalFileName.length > 3
  ) {
    return displayName + ".md";
  }
  return displayName;
}
