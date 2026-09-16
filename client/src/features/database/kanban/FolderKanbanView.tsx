import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Table, RefreshCw } from "lucide-react";
import {
  splitFrontmatterFile,
  parseYamlData,
  replaceScalarField,
  serializeYamlData,
  composeMarkdownFile,
} from "@shared/frontmatter";
import { useStore } from "../../../store";
import { api } from "../../../host";
import { cn } from "../../../lib/utils";
import type { FileContent } from "@shared/workspace";

/** A card is one markdown file placed in a lane by its `status` frontmatter. */
interface KanbanCard {
  path: string;
  title: string;
  status: string | null;
  hash: string;
  mtimeMs: number;
  raw: string;
}

const NO_STATUS = "__no_status__";
/** Lanes always shown, in this order, even when empty. */
const DEFAULT_STATUSES = ["todo", "doing", "done"];

function laneLabel(status: string): string {
  if (status === NO_STATUS) return "No status";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Frontmatter values may be strings, numbers, booleans, etc. Normalize to a lane key. */
function statusKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text.toLowerCase();
}

export function FolderKanbanView({ folderPath }: { folderPath: string }) {
  const workspace = useStore((s) => s.workspace);
  const nodes = useStore((s) => s.nodes);
  const openFile = useStore((s) => s.openFile);

  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);

  // Direct child markdown files of the folder. Root folder = parent is null.
  const markdownFiles = useMemo(
    () =>
      nodes.filter(
        (n) =>
          !n.isDir &&
          /\.md$/i.test(n.name) &&
          (folderPath === "" ? n.parent === null : n.parent === folderPath),
      ),
    [nodes, folderPath],
  );

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await Promise.all(
        markdownFiles.map(async (node) => {
          const file = await api<FileContent>(
            "/api/files/content?path=" + encodeURIComponent(node.id),
          );
          const split = splitFrontmatterFile(file.content ?? "");
          const data = parseYamlData(split.frontmatterRaw);
          const title =
            statusKey(data.title) !== null
              ? String(data.title)
              : node.name.replace(/\.md$/i, "");
          return {
            path: node.id,
            title,
            status: statusKey(data.status),
            hash: file.hash,
            mtimeMs: file.mtimeMs,
            raw: file.content ?? "",
          } satisfies KanbanCard;
        }),
      );
      setCards(loaded);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [workspace, markdownFiles]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lanes: default set plus any statuses actually present, then the no-status lane.
  const lanes = useMemo(() => {
    const present = new Set<string>();
    for (const card of cards) if (card.status) present.add(card.status);
    const ordered = [
      ...DEFAULT_STATUSES,
      ...[...present].filter((s) => !DEFAULT_STATUSES.includes(s)).sort(),
    ];
    return [...ordered, NO_STATUS];
  }, [cards]);

  const cardsByLane = useMemo(() => {
    const map = new Map<string, KanbanCard[]>();
    for (const lane of lanes) map.set(lane, []);
    for (const card of cards) {
      const key = card.status ?? NO_STATUS;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(card);
    }
    return map;
  }, [cards, lanes]);

  async function moveCard(cardPath: string, targetLane: string) {
    const card = cards.find((c) => c.path === cardPath);
    if (!card) return;
    const targetStatus = targetLane === NO_STATUS ? null : targetLane;
    if (card.status === targetStatus) return;

    // Optimistic UI update.
    setCards((prev) =>
      prev.map((c) =>
        c.path === cardPath ? { ...c, status: targetStatus } : c,
      ),
    );

    try {
      const nextContent = writeStatus(card.raw, targetStatus);
      const result = await api<{ hash: string; mtimeMs: number }>(
        "/api/files/content",
        "PUT",
        {
          path: cardPath,
          content: nextContent,
          baseHash: card.hash,
          baseMtimeMs: card.mtimeMs,
        },
      );
      setCards((prev) =>
        prev.map((c) =>
          c.path === cardPath
            ? {
                ...c,
                status: targetStatus,
                raw: nextContent,
                hash: result.hash,
                mtimeMs: result.mtimeMs,
              }
            : c,
        ),
      );
    } catch (e) {
      // Revert on failure and surface the error.
      setCards((prev) =>
        prev.map((c) =>
          c.path === cardPath ? { ...c, status: card.status } : c,
        ),
      );
      setError(String(e));
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-8 pt-3 pb-2 flex items-center gap-2 shrink-0">
        <Table size={18} className="text-maek-red" />
        <h1 className="text-sm font-semibold text-neutral-ink">
          {folderPath === "" ? "Workspace" : (folderPath.split("/").pop() ?? "")}
        </h1>
        <span className="text-xs text-muted-text">
          {cards.length} card{cards.length === 1 ? "" : "s"}
        </span>
        <button
          className="icon-button ml-auto"
          aria-label="Refresh kanban"
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {error && (
        <div role="alert" className="notice mx-8">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-text text-sm">
          Loading…
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto px-8 pb-6">
          <div className="flex gap-4 h-full items-start">
            {lanes.map((lane) => {
              const laneCards = cardsByLane.get(lane) ?? [];
              return (
                <div
                  key={lane}
                  className={cn(
                    "w-72 shrink-0 flex flex-col rounded-xl border bg-warm-vellum/40 max-h-full",
                    dragOverLane === lane
                      ? "border-maek-red"
                      : "border-default",
                  )}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverLane(lane);
                  }}
                  onDragLeave={() =>
                    setDragOverLane((cur) => (cur === lane ? null : cur))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverLane(null);
                    const from = dragged.current;
                    dragged.current = null;
                    if (from) void moveCard(from, lane);
                  }}
                >
                  <div className="px-3 py-2.5 flex items-center justify-between border-b border-default">
                    <span className="text-xs font-semibold uppercase tracking-wide text-neutral-ink">
                      {laneLabel(lane)}
                    </span>
                    <span className="text-xs text-muted-text">
                      {laneCards.length}
                    </span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
                    {laneCards.map((card) => (
                      <div
                        key={card.path}
                        draggable
                        onDragStart={() => {
                          dragged.current = card.path;
                        }}
                        onDragEnd={() => {
                          dragged.current = null;
                          setDragOverLane(null);
                        }}
                        onClick={() => void openFile(card.path)}
                        className="group rounded-lg border border-default bg-surface px-3 py-2 cursor-pointer hover:border-maek-red/60 transition-colors"
                      >
                        <p className="text-sm text-neutral-ink truncate">
                          {card.title}
                        </p>
                        <p className="text-[11px] text-muted-text truncate mt-0.5">
                          {card.path.split("/").pop()}
                        </p>
                      </div>
                    ))}
                    {laneCards.length === 0 && (
                      <p className="text-xs text-muted-text px-1 py-2">
                        Drop cards here
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Return the file content with its `status` frontmatter set to `status`
 * (or removed when null). Preserves the rest of the file byte-for-byte where
 * possible by using `replaceScalarField`; falls back to a YAML re-serialize
 * only when the surgical edit cannot apply.
 */
export function writeStatus(rawFile: string, status: string | null): string {
  const split = splitFrontmatterFile(rawFile);
  const existing = split.frontmatterRaw;

  // Removing status.
  if (status === null) {
    if (existing === null) return rawFile;
    const data = parseYamlData(existing);
    if (!("status" in data)) return rawFile;
    delete data.status;
    const nextRaw = Object.keys(data).length === 0 ? null : serializeYamlData(data);
    return composeMarkdownFile(
      nextRaw,
      split.body,
      split.lineEnding,
      nextRaw === null ? undefined : split.bodySeparator,
    );
  }

  // Setting status on a file that already has frontmatter.
  if (existing !== null) {
    const replaced = replaceScalarField(existing, "status", status);
    if (replaced !== null) {
      return composeMarkdownFile(
        replaced,
        split.body,
        split.lineEnding,
        split.bodySeparator,
      );
    }
    // Key absent or non-scalar: re-serialize the whole block.
    const data = parseYamlData(existing);
    data.status = status;
    return composeMarkdownFile(
      serializeYamlData(data),
      split.body,
      split.lineEnding,
      split.bodySeparator,
    );
  }

  // No frontmatter yet: create a canonical block.
  return composeMarkdownFile(
    serializeYamlData({ status }),
    split.body,
    split.lineEnding,
  );
}
