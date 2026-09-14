import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { registerWorkspace } from "../server/workspaces";
import { WorkspaceRuntimeManager } from "../server/workspace/runtime-manager";
import { isIgnored } from "../server/workspace/filesystem";

const roots: string[] = [];
const managers: WorkspaceRuntimeManager[] = [];
const run = promisify(execFile);
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function runFifoWatcher(root: string, addAfterReady = false) {
  const runtimeUrl = pathToFileURL(
    path.join(repositoryRoot, "server/workspace/runtime-manager.ts"),
  ).href;
  const workspacesUrl = pathToFileURL(
    path.join(repositoryRoot, "server/workspaces.ts"),
  ).href;
  const filesystemUrl = pathToFileURL(
    path.join(repositoryRoot, "server/workspace/filesystem.ts"),
  ).href;
  const source = `
    import { execFileSync } from "node:child_process";
    import path from "node:path";
    import { WorkspaceRuntimeManager } from ${JSON.stringify(runtimeUrl)};
    import { registerWorkspace } from ${JSON.stringify(workspacesUrl)};
    import { isIgnored } from ${JSON.stringify(filesystemUrl)};
    const root = ${JSON.stringify(root)};
    const workspace = await registerWorkspace(root);
    const manager = new WorkspaceRuntimeManager(isIgnored);
    let readyCount = 0;
    const timeout = setTimeout(() => process.exit(2), 1500);
    manager.get(workspace).watcher.subscribe(async (event) => {
      if (event.event !== "ready" || readyCount++) return;
      if (${JSON.stringify(addAfterReady)}) {
        execFileSync("mkfifo", [path.join(root, "late-pipe")]);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      clearTimeout(timeout);
      await manager.close();
      console.log("ready");
    });
  `;
  return run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    timeout: 3000,
  });
}

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

  it.skipIf(process.platform === "win32")(
    "does not block when a workspace contains or creates a FIFO",
    async () => {
      const initialRoot = await mkdtemp(path.join(tmpdir(), "maek-watch-fifo-"));
      const lateRoot = await mkdtemp(path.join(tmpdir(), "maek-watch-fifo-late-"));
      roots.push(initialRoot, lateRoot);
      await writeFile(path.join(initialRoot, "note.md"), "# note");
      await writeFile(path.join(lateRoot, "note.md"), "# note");
      await run("mkfifo", [path.join(initialRoot, "pipe")]);

      await expect(runFifoWatcher(initialRoot)).resolves.toMatchObject({
        stdout: expect.stringContaining("ready"),
      });
      await expect(runFifoWatcher(lateRoot, true)).resolves.toMatchObject({
        stdout: expect.stringContaining("ready"),
      });
    },
    10_000,
  );

  it("emits a single tabs-session-changed event when the root tabs document is replaced", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "maek-watch-tabs-"));
    roots.push(root);
    await mkdir(path.join(root, ".maek"), { recursive: true });
    const workspace = await registerWorkspace(root);
    const manager = new WorkspaceRuntimeManager(isIgnored);
    managers.push(manager);
    const runtime = manager.get(workspace);

    const events: string[] = [];
    await new Promise<void>((resolve) => {
      let ready = false;
      runtime.watcher.subscribe((event) => {
        if (event.event === "ready" && !ready) {
          ready = true;
          // Simulate the desktop app's atomic replace of the shared document.
          void (async () => {
            const target = path.join(root, ".maek/tabs.json");
            const temporary = target + ".tmp";
            await writeFile(temporary, JSON.stringify({ version: 4, tabs: [] }));
            await rename(temporary, target);
          })();
        }
        if (event.event === "tabs-session-changed") {
          events.push(event.event);
          setTimeout(resolve, 250); // Allow any duplicate emits to arrive.
        }
      });
    });
    expect(events).toEqual(["tabs-session-changed"]);
  }, 10_000);
});
