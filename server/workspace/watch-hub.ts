import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { Change, WorkspaceEvent } from "../../shared/workspace";
import type { Workspace } from "../workspaces";
import { isWorkspaceEntry, nodeFor } from "./filesystem";

type Subscriber = (event: WorkspaceEvent) => void;

/**
 * One OS watcher per canonical workspace root. HTTP/SSE connections subscribe
 * to this hub; they never own filesystem resources themselves.
 */
export class WorkspaceWatchHub {
  private watcher: FSWatcher | undefined;
  private tabsWatcher: FSWatcher | undefined;
  private tabsDebounce: ReturnType<typeof setTimeout> | undefined;
  private subscribers = new Set<Subscriber>();
  private identities = new Map<string, number>();
  private removed = new Map<
    string,
    { ino: number | undefined; timer: ReturnType<typeof setTimeout> }
  >();
  private relocated = new Set<string>();
  private revision = 0;
  private history: WorkspaceEvent[] = [];
  private ready = false;
  private metadataReady: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;

  constructor(
    private readonly workspace: Workspace,
    private readonly ignored: (relativePath: string) => boolean,
    /**
     * Optional hook invoked when an inode-preserving rename is detected for a
     * directory, before the `rename` SSE event is emitted. The host injects a
     * serialization-wrapped folder-appearance remap here so an external Finder
     * move preserves custom folder icons without racing an appearance PUT.
     */
    private readonly onDirectoryRename?: (
      source: string,
      destination: string,
    ) => Promise<void>,
  ) {}

  subscribe(subscriber: Subscriber, lastEventId?: number): () => void {
    this.subscribers.add(subscriber);
    this.start();
    if (this.ready) {
      const replay =
        lastEventId === undefined
          ? []
          : this.history.filter((event) => event.id > lastEventId);
      const canReplay =
        lastEventId !== undefined &&
        (replay.length > 0 || lastEventId === this.revision) &&
        (this.history[0]?.id ?? this.revision) <= lastEventId + 1;
      if (canReplay) {
        for (const event of replay) subscriber(event);
      } else {
        subscriber(this.envelope("ready", {}));
        subscriber(this.envelope("rescan", {}));
      }
    }
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private envelope(
    event: WorkspaceEvent["event"],
    data: Change | Record<string, never>,
  ): WorkspaceEvent {
    return {
      id: ++this.revision,
      workspaceRevision: this.revision,
      event,
      data,
    };
  }

  private emit(
    event: WorkspaceEvent["event"],
    data: Change | Record<string, never>,
  ) {
    const message = this.envelope(event, data);
    this.history.push(message);
    if (this.history.length > 256) this.history.shift();
    for (const subscriber of this.subscribers) subscriber(message);
  }

  private start() {
    if (this.watcher || this.closing) return;
    const watcher = watch(this.workspace.root, {
      ignoreInitial: false,
      alwaysStat: true,
      followSymlinks: false,
      ignored: (absolutePath, stats) =>
        this.ignored(path.relative(this.workspace.root, absolutePath)) ||
        (stats !== undefined && !isWorkspaceEntry(stats)),
    });
    this.watcher = watcher;
    watcher.on("ready", async () => {
      await this.metadataReady;
      this.ready = true;
      this.emit("ready", {});
      this.emit("rescan", {});
    });
    watcher.on("all", (type, absolutePath, stats) => {
      if (!["add", "change", "unlink", "addDir", "unlinkDir"].includes(type))
        return;
      const relativePath = path
        .relative(this.workspace.root, absolutePath)
        .split(path.sep)
        .join("/");
      if (!relativePath || this.ignored(relativePath)) return;
      const ino = stats?.ino;
      if (!this.ready) {
        if (ino) this.identities.set(relativePath, ino);
        return;
      }
      if (type === "unlink" || type === "unlinkDir") {
        const previous = this.identities.get(relativePath);
        this.identities.delete(relativePath);
        if (this.relocated.delete(relativePath)) return;
        const timer = setTimeout(() => {
          this.removed.delete(relativePath);
          this.emit("change", {
            type: type as Change["type"],
            path: relativePath,
          });
        }, 180);
        this.removed.set(relativePath, { ino: previous, timer });
        return;
      }
      if ((type === "add" || type === "addDir") && ino) {
        const removed = [...this.removed].find(
          ([oldPath, item]) => oldPath !== relativePath && item.ino === ino,
        );
        const existing =
          removed?.[0] ??
          [...this.identities].find(
            ([oldPath, identity]) =>
              oldPath !== relativePath && identity === ino,
          )?.[0];
        if (existing) {
          if (removed) {
            clearTimeout(removed[1].timer);
            this.removed.delete(existing);
          } else {
            this.relocated.add(existing);
          }
          this.identities.delete(existing);
          this.identities.set(relativePath, ino);
          const isDirectory = type === "addDir";
          const emitRename = () =>
            this.emit("change", {
              type: "rename",
              source: existing,
              path: relativePath,
              node: nodeFor(relativePath, isDirectory),
            });
          if (isDirectory && this.onDirectoryRename) {
            // Remap folder-appearance keys (under the host's serialization
            // lock) before announcing the rename, so the client reloads the
            // appearance store already pointing at the new paths. An
            // app-initiated move already remapped the keys, so this second run
            // is an idempotent no-op.
            void this.onDirectoryRename(existing, relativePath)
              .catch(() => {})
              .finally(emitRename);
          } else {
            emitRename();
          }
          return;
        }
      }
      if (ino) this.identities.set(relativePath, ino);
      this.emit("change", {
        type: type as Change["type"],
        path: relativePath,
        ...(type === "add" || type === "addDir"
          ? { node: nodeFor(relativePath, type === "addDir") }
          : {}),
      });
    });
    watcher.on("error", () => {
      this.emit("watch-error", {});
    });
    this.startTabsWatcher();
  }

  /**
   * The workspace-root `.maek/tabs.json` is excluded from the tree watcher
   * (all `.maek` metadata is ignored), yet the web UI must react when the
   * desktop app rewrites the shared open-tab list. Watch just that file and
   * coalesce the add/unlink/change burst of an atomic replace into a single
   * `tabs-session-changed` event.
   */
  private startTabsWatcher() {
    const directory = path.join(this.workspace.root, ".maek");
    const names = new Set([
      "tabs.json",
      "config.json",
      "recentFiles.json",
      "folder-appearance.json",
      "explorer-settings.json",
      "database.sqlite",
      "database.sqlite-wal",
    ]);
    const tabsWatcher = watch(directory, {
      ignoreInitial: true,
      depth: 0,
      followSymlinks: false,
      usePolling: true,
      interval: 200,
    });
    this.tabsWatcher = tabsWatcher;
    this.metadataReady = new Promise((resolve) => {
      tabsWatcher.once("ready", resolve);
      tabsWatcher.once("error", () => resolve());
    });
    const pending = new Set<string>();
    tabsWatcher.on("all", (type, absolutePath) => {
      if (!["add", "change", "unlink"].includes(type)) return;
      const name = path.basename(absolutePath);
      if (!names.has(name)) return;
      pending.add(name);
      clearTimeout(this.tabsDebounce);
      this.tabsDebounce = setTimeout(() => {
        if (this.ready)
          for (const changed of pending) {
            if (changed === "tabs.json") this.emit("tabs-session-changed", {});
            else
              this.emit("change", {
                type: "change",
                path:
                  ".maek/" +
                  (changed === "database.sqlite-wal"
                    ? "database.sqlite"
                    : changed),
              });
          }
        pending.clear();
      }, 120);
    });
  }

  async close(): Promise<void> {
    this.closing ??= (async () => {
      for (const item of this.removed.values()) clearTimeout(item.timer);
      this.removed.clear();
      clearTimeout(this.tabsDebounce);
      this.subscribers.clear();
      await Promise.all([this.watcher?.close(), this.tabsWatcher?.close()]);
      this.watcher = undefined;
      this.tabsWatcher = undefined;
    })();
    return this.closing;
  }
}
