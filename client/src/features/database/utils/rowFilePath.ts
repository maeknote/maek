/**
 * Build the workspace-relative path used by every file API call for a
 * database row. Database metadata already stores `folderPath` relative to the
 * workspace root, so the absolute workspace path must never be added here.
 */
export function databaseRowFilePath(folderPath: string, fileName: string): string {
  return folderPath ? `${folderPath}/${fileName}` : fileName
}
