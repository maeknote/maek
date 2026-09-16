import { FileText, FolderOpen, Plus } from "lucide-react";
import { useMemo, type ReactElement } from "react";
import { useStore } from "../../../store";
import { getDisplayName } from "../utils/displayName";

interface WorkspaceDashboardProps {
  onNewNote: () => void;
  onOpenNote: () => void;
}

function formatLastOpened(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return "Just now";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h ago`;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(timestamp).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  }).format(timestamp);
}

export function WorkspaceDashboard({
  onNewNote,
  onOpenNote,
}: WorkspaceDashboardProps): ReactElement {
  const workspace = useStore((state) => state.workspace);
  const nodes = useStore((state) => state.nodes);
  const recentFiles = useStore((state) => state.recentFiles);
  const openFile = useStore((state) => state.openFile);

  const recentNotes = useMemo(() => {
    const notesById = new Map(
      nodes
        .filter((node) => !node.isDir && /\.md$/i.test(node.name))
        .map((node) => [node.id, node]),
    );

    return recentFiles
      .map((recent) => ({ recent, node: notesById.get(recent.path) }))
      .filter(
        (item): item is typeof item & { node: NonNullable<typeof item.node> } =>
          Boolean(item.node),
      )
      .sort((a, b) => b.recent.lastOpened - a.recent.lastOpened)
      .slice(0, 8);
  }, [nodes, recentFiles]);

  return (
    <article className="h-full overflow-auto bg-surface">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-8 pb-16 pt-[clamp(5rem,14vh,9rem)]">
        <header>
          <p className="text-sm text-muted-text">{workspace?.name}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-neutral-ink">
            Start writing
          </h1>
        </header>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onNewNote}
            className="group flex min-h-24 items-center gap-4 rounded-xl border border-border-subtle bg-surface px-5 text-left transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maek-red/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-maek-red text-white">
              <Plus size={20} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block text-sm font-medium text-neutral-ink">
                New note
              </span>
              <span className="mt-1 block text-xs text-muted-text">
                Create a blank Markdown note
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenNote}
            className="group flex min-h-24 items-center gap-4 rounded-xl border border-border-subtle bg-surface px-5 text-left transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maek-red/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-overlay text-neutral-ink">
              <FolderOpen size={19} strokeWidth={1.7} />
            </span>
            <span>
              <span className="block text-sm font-medium text-neutral-ink">
                Open note
              </span>
              <span className="mt-1 block text-xs text-muted-text">
                Find a note in this workspace
              </span>
            </span>
          </button>
        </div>

        <section className="mt-12" aria-labelledby="recent-notes-heading">
          <div className="flex items-center justify-between border-b border-border-subtle pb-3">
            <h2
              id="recent-notes-heading"
              className="text-xs font-medium uppercase tracking-[0.08em] text-muted-text"
            >
              Recent notes
            </h2>
            {recentNotes.length > 0 && (
              <span className="text-xs text-muted-text">
                {recentNotes.length} {recentNotes.length === 1 ? "note" : "notes"}
              </span>
            )}
          </div>

          {recentNotes.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <FileText size={24} strokeWidth={1.3} className="text-muted-text" />
              <p className="mt-3 text-sm text-muted-text">No recent notes yet</p>
              <p className="mt-1 text-xs text-muted-text">
                Notes you open will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {recentNotes.map(({ recent, node }) => {
                const parentPath = node.parent || workspace?.name || "";
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => void openFile(node.id)}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maek-red/40"
                  >
                    <FileText
                      size={17}
                      strokeWidth={1.6}
                      className="shrink-0 text-muted-text transition-colors group-hover:text-maek-red"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-neutral-ink">
                        {getDisplayName(node.name)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-text">
                        {parentPath}
                      </span>
                    </span>
                    <time
                      dateTime={new Date(recent.lastOpened).toISOString()}
                      className="shrink-0 text-xs text-muted-text"
                    >
                      {formatLastOpened(recent.lastOpened)}
                    </time>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </article>
  );
}
