import type { FileNode } from "@shared/workspace";
import { isHiddenTreePath } from "./hiddenPath";

/** Retain unaffected branches while rebuilding parent/child relationships.
 * The flat workspace snapshot is sorted once per batch, so each folder's
 * children arrive in display order without sorting the entire tree again. */
export class ExplorerTreeIndex {
  private entries = new Map<string, { source: FileNode; tree: FileNode }>();
  private roots: FileNode[] = [];

  build(nodes: FileNode[], databases: ReadonlyMap<string, string>, showHidden: boolean): FileNode[] {
    const visible = showHidden ? nodes : nodes.filter(node => !isHiddenTreePath(node.id));
    const children = new Map<string | null, FileNode[]>();
    for (const node of visible) {
      let siblings = children.get(node.parent);
      if (!siblings) { siblings = []; children.set(node.parent, siblings); }
      siblings.push(node);
    }
    const next = new Map<string, { source: FileNode; tree: FileNode }>();
    const buildNode = (source: FileNode): FileNode => {
      const previous = this.entries.get(source.id);
      const descendants = source.isDir && !databases.has(source.id)
        ? (children.get(source.id) ?? []).map(buildNode) : undefined;
      const unchangedChildren = descendants === undefined ? previous?.tree.children === undefined
        : previous?.tree.children?.length === descendants.length
          && descendants.every((child, index) => child === previous.tree.children![index]);
      const tree = previous?.source === source && unchangedChildren
        ? previous.tree : { ...source, children: descendants };
      next.set(source.id, { source, tree });
      return tree;
    };
    const roots = (children.get(null) ?? []).map(buildNode);
    this.entries = next;
    if (roots.length !== this.roots.length || roots.some((node, index) => node !== this.roots[index])) this.roots = roots;
    return this.roots;
  }
}
