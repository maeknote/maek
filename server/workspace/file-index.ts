import type { Change, FileNode } from "../../shared/workspace";
import { compareFileNodes, isWithinPath } from "../../shared/workspace-changes";
import type { Workspace } from "../workspaces";
import { scanWorkspace } from "./filesystem";

// Registration canonicalizes roots and reuses a workspace handle. Consumers
// share its index; the runtime owns watching and disposal. Weak keys do not
// retain an additional workspace registry.
const indexes = new WeakMap<Workspace, WorkspaceFileIndex>();
export function getWorkspaceFileIndex(workspace: Workspace): WorkspaceFileIndex {
  let index = indexes.get(workspace);
  if (!index) {
    index = new WorkspaceFileIndex(workspace);
    indexes.set(workspace, index);
  }
  return index;
}

export function releaseWorkspaceFileIndex(workspace: Workspace, index: WorkspaceFileIndex) {
  if (indexes.get(workspace) === index) indexes.delete(workspace);
}

export class WorkspaceFileIndex {
  private nodes = new Map<string, FileNode>();
  private warnings: string[] = [];
  private dirty = true;
  private generation = 0;
  private scanning: Promise<void> | undefined;
  private duringScan: Change[] = [];
  private tree: FileNode[] | undefined;

  constructor(private readonly workspace: Workspace) {}

  invalidate() {
    this.dirty = true;
    this.generation++;
    this.tree = undefined;
  }

  clear() {
    this.nodes.clear();
    this.warnings = [];
    this.invalidate();
  }

  apply(change: Change) {
    if (change.type === "change") return;
    if (this.scanning) {
      if (this.duringScan.length < 4096) this.duringScan.push(change);
      else { this.duringScan = []; this.invalidate(); }
    }
    if (!this.dirty) this.applyToNodes(change);
  }

  private applyToNodes(change: Change) {
    if (change.type === "rename" && change.source) {
      for (const [id, node] of [...this.nodes]) {
        if (!isWithinPath(id, change.source)) continue;
        const destination = change.path + id.slice(change.source.length);
        this.nodes.delete(id);
        this.nodes.set(destination, {
          ...node, id: destination, name: destination.split("/").at(-1)!,
          parent: destination.split("/").slice(0, -1).join("/") || null,
        });
      }
      if (change.node && !this.nodes.has(change.path)) this.nodes.set(change.path, change.node);
    } else if (change.type === "unlink") {
      this.nodes.delete(change.path);
    } else if (change.type === "unlinkDir") {
      for (const id of this.nodes.keys()) {
        if (isWithinPath(id, change.path)) this.nodes.delete(id);
      }
    } else if (change.node) this.nodes.set(change.path, change.node);
    this.tree = undefined;
  }

  private async ensureCurrent(): Promise<void> {
    if (this.dirty && !this.scanning) {
      const generation = this.generation;
      this.duringScan = [];
      this.scanning = scanWorkspace(this.workspace).then(snapshot => {
        this.nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
        this.warnings = snapshot.warnings;
        for (const change of this.duringScan) this.applyToNodes(change);
        this.dirty = this.generation !== generation;
        this.tree = undefined;
      }).finally(() => { this.scanning = undefined; this.duringScan = []; });
    }
    await this.scanning;
    if (this.dirty) await this.ensureCurrent();
  }

  /** Internal discovery also sees entries hidden from the explorer. */
  async filesNamed(name: string): Promise<string[]> {
    await this.ensureCurrent();
    return [...this.nodes.values()].filter(node => !node.isDir && node.name === name)
      .map(node => node.id);
  }

  async snapshot() {
    await this.ensureCurrent();
    this.tree ??= [...this.nodes.values()]
      .filter(node => node.name !== ".maek-database.json")
      .sort(compareFileNodes);
    return { nodes: this.tree, warnings: this.warnings };
  }
}
