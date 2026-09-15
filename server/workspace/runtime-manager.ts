import type { Workspace } from "../workspaces";
import { WorkspaceFileIndex } from "./file-index";
import { WorkspaceWatchHub } from "./watch-hub";

export class WorkspaceRuntime {
  readonly watcher: WorkspaceWatchHub;
  readonly files: WorkspaceFileIndex;
  private readonly unsubscribe: () => void;

  constructor(workspace: Workspace, ignored: (relativePath: string) => boolean) {
    this.files = new WorkspaceFileIndex(workspace);
    this.watcher = new WorkspaceWatchHub(workspace, ignored);
    this.unsubscribe = this.watcher.subscribe((event) => {
      if (event.event === "rescan") this.files.invalidate();
      if (event.event === "change") {
        const change = event.data as import("../../shared/workspace").Change;
        if (!change.path.endsWith("/.maek-database.json") && change.path !== ".maek-database.json")
          this.files.apply(change);
      }
    });
  }

  close() {
    this.unsubscribe();
    return this.watcher.close();
  }
}

export class WorkspaceRuntimeManager {
  private readonly runtimes = new Map<string, WorkspaceRuntime>();

  constructor(private readonly ignored: (relativePath: string) => boolean) {}

  get(workspace: Workspace): WorkspaceRuntime {
    let runtime = this.runtimes.get(workspace.root);
    if (!runtime) {
      runtime = new WorkspaceRuntime(workspace, this.ignored);
      this.runtimes.set(workspace.root, runtime);
    }
    return runtime;
  }

  get watcherCount(): number {
    return this.runtimes.size;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.runtimes.values()].map((runtime) => runtime.close()),
    );
    this.runtimes.clear();
  }
}
