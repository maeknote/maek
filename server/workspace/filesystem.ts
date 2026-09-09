import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { FileNode } from "../../shared/workspace";
import { badRequest } from "../errors";
import { resolveInWorkspace } from "../fs/guard";
import type { Workspace } from "../workspaces";

const ignoredNames = new Set([
  ".maek",
  ".maek-data",
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  "coverage",
  ".venv",
  "venv",
  ".virtualenv",
  "virtualenv",
  "site-packages",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".ipynb_checkpoints",
  ".gradle",
  "Pods",
  ".terraform",
  ".cache",
  ".vscode",
  ".idea",
]);

export const isIgnored = (relativePath: string) =>
  relativePath
    .split(/[\\/]/)
    .some((segment) => ignoredNames.has(segment) || segment.endsWith(".tmp"));

export const nodeFor = (
  relativePath: string,
  isDir: boolean,
): FileNode => ({
  id: relativePath,
  name: path.basename(relativePath),
  parent:
    path.posix.dirname(relativePath) === "."
      ? null
      : path.posix.dirname(relativePath),
  isDir,
});

export async function workspaceTarget(
  workspace: Workspace,
  relativePath: string,
) {
  const absolutePath = await resolveInWorkspace(workspace, relativePath);
  let current = workspace.root;
  for (const part of relativePath.split("/").filter(Boolean)) {
    current = path.join(current, part);
    const stats = await lstat(current).catch(() => null);
    if (stats?.isSymbolicLink()) {
      throw badRequest("Symbolic links are not supported");
    }
  }
  return absolutePath;
}

export async function scanWorkspace(workspace: Workspace) {
  const nodes: FileNode[] = [];
  const warnings: string[] = [];
  const pending = [""];
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await readdir(
      path.join(workspace.root, directory),
      { withFileTypes: true },
    ).catch(() => {
      warnings.push(directory);
      return [];
    });
    for (const entry of entries) {
      const relativePath = path.posix.join(directory, entry.name);
      if (
        isIgnored(relativePath) ||
        (!entry.isDirectory() && !entry.isFile())
      ) {
        continue;
      }
      nodes.push(nodeFor(relativePath, entry.isDirectory()));
      if (entry.isDirectory()) pending.push(relativePath);
    }
  }
  nodes.sort(
    (a, b) =>
      Number(b.isDir) - Number(a.isDir) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
  return { nodes, warnings };
}
