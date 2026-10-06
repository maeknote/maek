import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as filesystem from "../server/workspace/filesystem";
import { getWorkspaceFileIndex, WorkspaceFileIndex } from "../server/workspace/file-index";
import { registerWorkspace } from "../server/workspaces";
import { WorkspaceRuntimeManager } from "../server/workspace/runtime-manager";

const roots: string[] = [];
const managers: WorkspaceRuntimeManager[] = [];
async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "maek-index-"));
  roots.push(root);
  return registerWorkspace(root);
}
afterEach(async () => {
  await Promise.all(managers.splice(0).map(manager => manager.close()));
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("shared workspace file index", () => {
  it("shares one concurrent scan for tree and manifest discovery and excludes dependencies", async () => {
    const ws = await workspace();
    await mkdir(path.join(ws.root, "Board"));
    await mkdir(path.join(ws.root, "Project/.venv/deep"), { recursive: true });
    await writeFile(path.join(ws.root, "Board/.maek-database.json"), "{}");
    await writeFile(path.join(ws.root, "Project/.venv/deep/.maek-database.json"), "{}");
    const scan = vi.spyOn(filesystem, "scanWorkspace");
    const index = getWorkspaceFileIndex(ws);
    const [tree, manifests] = await Promise.all([index.snapshot(), index.filesNamed(".maek-database.json")]);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(manifests).toEqual(["Board/.maek-database.json"]);
    expect(tree.nodes.map(node => node.id)).toEqual(["Board", "Project"]);
    expect(getWorkspaceFileIndex(await registerWorkspace(ws.root))).toBe(index);
    index.apply({ type: "change", path: "Board/Task.md" });
    expect((await index.snapshot()).nodes).toBe(tree.nodes);
    await index.filesNamed(".maek-database.json");
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("updates discovered manifests through moves and deletion without another scan", async () => {
    const ws = await workspace();
    const index = new WorkspaceFileIndex(ws);
    await index.snapshot();
    const scan = vi.spyOn(filesystem, "scanWorkspace");
    index.apply({ type: "add", path: "Board/.maek-database.json", node: filesystem.nodeFor("Board/.maek-database.json", false) });
    index.apply({ type: "rename", source: "Board", path: "Moved" });
    expect(await index.filesNamed(".maek-database.json")).toEqual(["Moved/.maek-database.json"]);
    index.apply({ type: "unlinkDir", path: "Moved" });
    expect(await index.filesNamed(".maek-database.json")).toEqual([]);
    expect(scan).not.toHaveBeenCalled();
  });

  it("retains changes arriving during an initial scan", async () => {
    const ws = await workspace();
    let finish!: (snapshot: Awaited<ReturnType<typeof filesystem.scanWorkspace>>) => void;
    vi.spyOn(filesystem, "scanWorkspace").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const index = new WorkspaceFileIndex(ws);
    const snapshot = index.snapshot();
    index.apply({ type: "add", path: "late.md", node: filesystem.nodeFor("late.md", false) });
    finish({ nodes: [], warnings: [] });
    expect((await snapshot).nodes.map(node => node.id)).toEqual(["late.md"]);
  });

  it("rescans after an explicit invalidation interrupts a scan", async () => {
    const ws = await workspace();
    let finish!: (snapshot: Awaited<ReturnType<typeof filesystem.scanWorkspace>>) => void;
    const scan = vi.spyOn(filesystem, "scanWorkspace").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const index = new WorkspaceFileIndex(ws);
    const snapshot = index.snapshot();
    await writeFile(path.join(ws.root, "new.md"), "new");
    index.invalidate();
    finish({ nodes: [], warnings: [] });
    expect((await snapshot).nodes.map(node => node.id)).toEqual(["new.md"]);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("recovers from a bounded scan journal overflow with a fresh snapshot", async () => {
    const ws = await workspace();
    let finish!: (snapshot: Awaited<ReturnType<typeof filesystem.scanWorkspace>>) => void;
    const scan = vi.spyOn(filesystem, "scanWorkspace").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const index = new WorkspaceFileIndex(ws);
    const snapshot = index.snapshot();
    for (let i = 0; i < 4100; i++) index.apply({
      type: "add", path: `${i}.md`, node: filesystem.nodeFor(`${i}.md`, false),
    });
    await writeFile(path.join(ws.root, "final.md"), "actual final state");
    finish({ nodes: [], warnings: [] });
    expect((await snapshot).nodes.map(node => node.id)).toEqual(["final.md"]);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("holds active runtimes and releases idle watchers and indexes", async () => {
    const ws = await workspace();
    const onIdle = vi.fn();
    const manager = new WorkspaceRuntimeManager(filesystem.isIgnored, undefined, undefined, { idleTimeoutMs: 25, onIdle });
    managers.push(manager);
    const lease = manager.acquire(ws);
    const files = lease.runtime.files;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(manager.watcherCount).toBe(1);
    lease.release();
    lease.release();
    await expect.poll(() => manager.watcherCount).toBe(0);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(manager.get(ws).files).not.toBe(files);
  });
});
