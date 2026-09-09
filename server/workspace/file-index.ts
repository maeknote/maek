import type { Change, FileNode } from "../../shared/workspace";
import type { Workspace } from "../workspaces";
import { scanWorkspace } from "./filesystem";

export class WorkspaceFileIndex {
  private nodes = new Map<string, FileNode>();
  private warnings: string[] = [];
  private dirty = true;

  constructor(private readonly workspace: Workspace) {}

  invalidate() {
    this.dirty = true;
  }

  apply(change: Change) {
    if (this.dirty) return;
    if (change.type === "rename" && change.source) {
      const source = change.source;
      const destination = change.path;
      const moved = [...this.nodes.values()].filter(
        (node) => node.id === source || node.id.startsWith(source + "/"),
      );
      for (const node of moved) this.nodes.delete(node.id);
      for (const node of moved) {
        const id =
          node.id === source
            ? destination
            : destination + node.id.slice(source.length);
        this.nodes.set(id, {
          ...node,
          id,
          name: id.split("/").at(-1)!,
          parent: id.split("/").slice(0, -1).join("/") || null,
        });
      }
      return;
    }
    if (change.type === "unlink" || change.type === "unlinkDir") {
      for (const id of this.nodes.keys()) {
        if (id === change.path || id.startsWith(change.path + "/")) {
          this.nodes.delete(id);
        }
      }
      return;
    }
    if (change.node) this.nodes.set(change.path, change.node);
  }

  async snapshot() {
    if (this.dirty) {
      const snapshot = await scanWorkspace(this.workspace);
      this.nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
      this.warnings = snapshot.warnings;
      this.dirty = false;
    }
    return {
      nodes: [...this.nodes.values()].sort(
        (a, b) =>
          Number(b.isDir) - Number(a.isDir) ||
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      ),
      warnings: this.warnings,
    };
  }
}
