import path from "node:path";
import type { PreviewKind } from "../../shared/workspace";

export const previewMime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

export function kindFor(relativePath: string): PreviewKind {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".md" || extension === ".markdown") return "editor";
  if (extension === ".pdf") return "pdf";
  if (extension === ".html" || extension === ".htm") return "html";
  if (previewMime[extension]?.startsWith("image/")) return "image";
  if (
    [
      ".txt",
      ".json",
      ".yaml",
      ".yml",
      ".csv",
      ".log",
      ".css",
      ".js",
      ".ts",
      ".py",
      ".sh",
      ".xml",
      ".toml",
      ".ini",
    ].includes(extension)
  ) {
    return "text";
  }
  return "unsupported";
}
