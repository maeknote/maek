import type { Change, FileNode } from "./workspace";

export const isWithinPath = (path: string, ancestor: string) =>
  ancestor === "" || path === ancestor || path.startsWith(ancestor + "/");

export const compareFileNodes = (a: FileNode, b: FileNode) =>
  Number(b.isDir) - Number(a.isDir) ||
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/** Content changes never alter the explorer's list of paths. */
export const isTreeChange = (change: Change) => change.type !== "change";

/** Keep structural operations in order; only collapse repeated content writes.
 * A structural operation is a barrier because a path may be deleted/recreated
 * or renamed between two writes. The caller bounds the batch size. */
export class WorkspaceChangeBatch {
  private changes: Change[] = [];
  private writes = new Map<string, number>();

  get size() { return this.changes.length; }

  add(change: Change) {
    if (change.type === "change") {
      const position = this.writes.get(change.path);
      if (position !== undefined) {
        this.changes[position] = change;
        return;
      }
      this.writes.set(change.path, this.changes.length);
    } else {
      this.writes.clear();
    }
    this.changes.push(change);
  }

  take(): Change[] {
    const changes = this.changes;
    this.changes = [];
    this.writes.clear();
    return changes;
  }
}

/** One map update and one sort for a burst, retaining unchanged node objects. */
export function applyTreeChanges(
  nodes: FileNode[], changes: Change[], includePath: (path: string) => boolean = () => true,
): FileNode[] {
  const structural = changes.filter(isTreeChange);
  if (!structural.length) return nodes;
  const next = new Map(nodes.map(node => [node.id, node]));
  let modified = false;
  for (const change of structural) {
    if (change.type === "rename" && change.source) {
      for (const [id, node] of [...next]) {
        if (!isWithinPath(id, change.source)) continue;
        const destination = change.path + id.slice(change.source.length);
        next.delete(id);
        if (includePath(destination)) next.set(destination, {
          ...node, id: destination, name: destination.split("/").at(-1)!,
          parent: destination.split("/").slice(0, -1).join("/") || null,
        });
        modified = true;
      }
      // The source can be absent from a filtered snapshot or already moved by
      // an API response. A rename still announces its destination node.
      if (change.node && includePath(change.path) && !next.has(change.path)) {
        next.set(change.path, change.node);
        modified = true;
      }
    } else if (change.type === "unlink" || change.type === "unlinkDir") {
      if (change.type === "unlink") modified = next.delete(change.path) || modified;
      else for (const id of next.keys()) {
        if (isWithinPath(id, change.path)) modified = next.delete(id) || modified;
      }
    } else if (change.node && includePath(change.path)) {
      const previous = next.get(change.path);
      if (previous?.isDir === change.node.isDir && previous.name === change.node.name
        && previous.parent === change.node.parent) continue;
      next.set(change.path, change.node);
      modified = true;
    }
  }
  return modified ? [...next.values()].sort(compareFileNodes) : nodes;
}
