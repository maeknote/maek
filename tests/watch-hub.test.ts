import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerWorkspace } from "../server/workspaces";
import { WorkspaceRuntimeManager } from "../server/workspace/runtime-manager";

const roots: string[] = [];
const managers: WorkspaceRuntimeManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("WorkspaceRuntimeManager", () => {
  it("shares exactly one watcher between subscribers of the same root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "maek-watch-hub-"));
    roots.push(root);
    const workspace = await registerWorkspace(root);
    const manager = new WorkspaceRuntimeManager(() => false);
    managers.push(manager);
    const runtimeA = manager.get(workspace);
    const runtimeB = manager.get(workspace);
    expect(runtimeA).toBe(runtimeB);
    expect(manager.watcherCount).toBe(1);

    const unsubscribeA = runtimeA.watcher.subscribe(() => {});
    const unsubscribeB = runtimeB.watcher.subscribe(() => {});
    unsubscribeA();
    unsubscribeB();
    expect(manager.watcherCount).toBe(1);
  });
});
