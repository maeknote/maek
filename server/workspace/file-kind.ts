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

export const artifactMime: Record<string, string> = {
  ...previewMime,
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
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
