/** Display files without extension */
export function getDisplayName(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  // Only strip extension if it's a valid extension (e.g. not a dotfile without other dots)
  if (lastDotIndex > 0 && lastDotIndex < fileName.length - 1) {
    return fileName.slice(0, lastDotIndex);
  }
  return fileName;
}

export function toFileName(
  displayName: string,
  originalFileName: string,
): string {
  const lastDotIndex = originalFileName.lastIndexOf(".");
  if (lastDotIndex > 0 && lastDotIndex < originalFileName.length - 1) {
    const ext = originalFileName.slice(lastDotIndex);
    if (!displayName.toLowerCase().endsWith(ext.toLowerCase())) {
      return displayName + ext;
    }
  }
  return displayName;
}
