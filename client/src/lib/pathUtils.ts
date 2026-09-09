// Path Utilities for Renderer
// Simple path operations that work in the browser environment
// (Node.js path module is not directly available in renderer)

/**
 * Join path segments together with forward slashes
 */
export function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

/**
 * Normalize a path by resolving "." and ".." segments.
 */
export function normalizePath(path: string): string {
  const isAbsolute = path.startsWith("/");
  const segments = path.split("/");
  const normalized: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (normalized.length > 0) normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  if (isAbsolute) {
    return "/" + normalized.join("/");
  }

  return normalized.join("/") || ".";
}

/**
 * Get the directory name from a path
 */
export function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

/**
 * Get the base name (last segment) from a path
 */
export function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || "";
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function decodeInternalHrefPath(path: string): string {
  const [pathWithoutHash = ""] = path.split("#");
  const [pathWithoutQuery = ""] = pathWithoutHash.split("?");
  return pathWithoutQuery.split("/").map(decodePathSegment).join("/");
}

function encodeInternalHrefPath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      if (segment === "." || segment === ".." || segment === "") return segment;
      return encodeURIComponent(segment);
    })
    .join("/");
}

/**
 * Resolve a target path relative to a base directory.
 */
export function resolvePath(baseDir: string, targetPath: string): string {
  const decodedTargetPath = decodeInternalHrefPath(targetPath);
  if (decodedTargetPath.startsWith("/")) {
    return normalizePath(decodedTargetPath);
  }
  return normalizePath(join(baseDir, decodedTargetPath));
}

/**
 * Compute a relative path from one file to another (POSIX-style).
 * Both paths must be absolute.
 */
export function relativePath(fromFile: string, toFile: string): string {
  const fromParts = dirname(fromFile).split("/").filter(Boolean);
  const toParts = toFile.split("/").filter(Boolean);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.length - common;
  const remaining = toParts.slice(common);
  const result = [...Array(ups).fill(".."), ...remaining].join("/");
  return result.startsWith("..") ? result : "./" + result;
}

/**
 * Compute an encoded href for a workspace target.
 *
 * Markdown link destinations are fragile when raw paths contain spaces,
 * parentheses, or other punctuation common in database row titles. Keep path
 * separators and relative segments readable, but encode real file-name
 * segments so the link survives a Markdown parse/serialize round trip.
 */
export function workspaceHref(fromFile: string, toFile: string): string {
  return encodeInternalHrefPath(relativePath(fromFile, toFile));
}

/**
 * Normalize a user-edited workspace href before storing it in a link mark.
 */
export function normalizeWorkspaceHref(href: string): string {
  const trimmed = href.trim();
  const suffixStart = trimmed.search(/[?#]/);
  if (suffixStart < 0) {
    return encodeInternalHrefPath(decodeInternalHrefPath(trimmed));
  }

  const pathPart = trimmed.slice(0, suffixStart);
  const suffix = trimmed.slice(suffixStart);
  return `${encodeInternalHrefPath(decodeInternalHrefPath(pathPart))}${suffix}`;
}

/**
 * Check if an href points to an internal workspace link.
 */
export function isWorkspaceLinkHref(href: string): boolean {
  if (!href) return false;
  if (/^(https?:\/\/|mailto:|tel:|#|data:|file:)/.test(href)) return false;
  return true;
}

/**
 * Check if an href points to an internal note/workspace link.
 *
 * The historical name is kept for call-site compatibility. Workspace links now
 * include database folders as well as markdown files.
 */
export function isNoteLinkHref(href: string): boolean {
  return isWorkspaceLinkHref(href);
}

/**
 * Convert a local absolute file path to a file:// URL.
 */
export function toFileUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  const encodedPath = normalizedPath
    .split("/")
    .map((segment, index) => {
      if (index === 0 && segment === "") return "";
      return encodeURIComponent(segment);
    })
    .join("/");

  return `file://${encodedPath}`;
}
