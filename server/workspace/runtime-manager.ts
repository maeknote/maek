import type { Workspace } from "../workspaces";
import { getWorkspaceFileIndex, releaseWorkspaceFileIndex, type WorkspaceFileIndex } from "./file-index";
import { WorkspaceWatchHub } from "./watch-hub";

export class WorkspaceRuntime {
  readonly watcher: WorkspaceWatchHub;
  readonly files: WorkspaceFileIndex;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly workspace: Workspace,
    ignored: (relativePath: string) => boolean,
    onDirectoryRename?: (source: string, destination: string) => Promise<void>,
    isDatabaseChangeRelevant?: () => boolean,
  ) {
    this.files = getWorkspaceFileIndex(workspace);
    this.watcher = new WorkspaceWatchHub(workspace, ignored, onDirectoryRename, isDatabaseChangeRelevant);
    this.unsubscribe = this.watcher.subscribe((event) => {
      if (event.event === "rescan") this.files.invalidate();
      if (event.event === "change") {
        const change = event.data as import("../../shared/workspace").Change;
        if (!change.path.startsWith(".maek/"))
          this.files.apply(change);
      }
    });
  }

  async close() {
    this.unsubscribe();
    releaseWorkspaceFileIndex(this.workspace, this.files);
    await this.watcher.close();
    this.files.clear();
  }
}

export class WorkspaceRuntimeManager {
  private readonly runtimes = new Map<string, {
    runtime: WorkspaceRuntime;
    workspace: Workspace;
    users: number;
    idle?: ReturnType<typeof setTimeout>;
  }>();

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
    private readonly isDatabaseChangeRelevant?: (workspace: Workspace) => boolean,
    private readonly options: {
      idleTimeoutMs?: number;
      onIdle?: (workspace: Workspace) => void;
    } = {},
  ) {}

  get(workspace: Workspace): WorkspaceRuntime {
    let entry = this.runtimes.get(workspace.root);
    if (!entry) {
      const runtime = new WorkspaceRuntime(
        workspace,
        this.ignored,
        this.onDirectoryRename?.(workspace),
        this.isDatabaseChangeRelevant ? () => this.isDatabaseChangeRelevant!(workspace) : undefined,
      );
      entry = { runtime, workspace, users: 0 };
      this.runtimes.set(workspace.root, entry);
    }
    if (!entry.users) this.scheduleIdle(entry);
    return entry.runtime;
  }

  /** HTTP requests and SSE streams hold a lease until their response closes. */
  acquire(workspace: Workspace) {
    const runtime = this.get(workspace);
    const entry = this.runtimes.get(workspace.root)!;
    clearTimeout(entry.idle);
    entry.users++;
    let released = false;
    return { runtime, release: () => {
      if (released) return;
      released = true;
      entry.users--;
      if (!entry.users && this.runtimes.get(workspace.root) === entry) this.scheduleIdle(entry);
    } };
  }

  private scheduleIdle(entry: {
    runtime: WorkspaceRuntime; workspace: Workspace; users: number;
    idle?: ReturnType<typeof setTimeout>;
  }) {
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => {
      this.runtimes.delete(entry.workspace.root);
      this.options.onIdle?.(entry.workspace);
      void entry.runtime.close();
    }, this.options.idleTimeoutMs ?? 60_000);
    entry.idle.unref();
  }

  get watcherCount(): number {
    return this.runtimes.size;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.runtimes.values()].map((entry) => {
        clearTimeout(entry.idle);
        return entry.runtime.close();
      }),
    );
    this.runtimes.clear();
  }
}
