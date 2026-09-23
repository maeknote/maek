/**
 * A workspace-relative path is "hidden" when any of its segments begins with a
 * dot (e.g. `.gitignore`, `.codex/config`, `notes/.private/todo.md`). The
 * server already excludes managed and dependency folders (`.maek`, `.git`,
 * `node_modules`, …) from the tree snapshot, so this only governs the
 * remaining dot-prefixed user entries surfaced by the "Show hidden files"
 * toggle.
 */
export function isHiddenTreePath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((segment) => segment.startsWith("."));
}
