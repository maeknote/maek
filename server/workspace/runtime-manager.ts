import type { Workspace } from "../workspaces";
import { WorkspaceFileIndex } from "./file-index";
import { WorkspaceWatchHub } from "./watch-hub";

export class WorkspaceRuntime {
  readonly watcher: WorkspaceWatchHub;
  readonly files: WorkspaceFileIndex;
  private readonly unsubscribe: () => void;

  constructor(
    workspace: Workspace,
    ignored: (relativePath: string) => boolean,
    onDirectoryRename?: (source: string, destination: string) => Promise<void>,
  ) {
    this.files = new WorkspaceFileIndex(workspace);
    this.watcher = new WorkspaceWatchHub(workspace, ignored, onDirectoryRename);
    this.unsubscribe = this.watcher.subscribe((event) => {
      if (event.event === "rescan") this.files.invalidate();
      if (event.event === "change") {
        const change = event.data as import("../../shared/workspace").Change;
        if (!change.path.startsWith(".maek/") && !change.path.endsWith("/.maek-database.json") && change.path !== ".maek-database.json")
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

  constructor(
    private readonly ignored: (relativePath: string) => boolean,
    /**
     * Builds the directory-rename hook for a workspace. The host supplies a
     * serialization-wrapped folder-appearance remap so external Finder moves
     * preserve custom folder icons.
     */
    private readonly onDirectoryRename?: (
      workspace: Workspace,
    ) => (source: string, destination: string) => Promise<void>,
  ) {}

  get(workspace: Workspace): WorkspaceRuntime {
    let runtime = this.runtimes.get(workspace.root);
    if (!runtime) {
      runtime = new WorkspaceRuntime(
        workspace,
        this.ignored,
        this.onDirectoryRename?.(workspace),
      );
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
