import { useMemo } from "react";
import { useStore } from "@renderer/features/workspace";
interface RecentFileEntry {
  lastOpenedAt: number;
  openCount: number;
}
export function recencyScoreFor(
  entry: RecentFileEntry | undefined,
  now = Date.now(),
) {
  if (!entry) return 0;
  const days = Math.max(0, (now - entry.lastOpenedAt) / (24 * 60 * 60 * 1000));
  return entry.openCount * Math.exp((-Math.log(2) * days) / 30);
}
export function topRecentsFrom(
  entries: Record<string, RecentFileEntry>,
  limit: number,
  now = Date.now(),
) {
  return Object.entries(entries)
    .map(([fileId, entry]) => ({ fileId, score: recencyScoreFor(entry, now) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
export function useRecentFilesStore<T>(
  selector: (state: { entries: Record<string, RecentFileEntry> }) => T,
): T {
  const recents = useStore((s) => s.recentFiles);
  const entries = useMemo(
    () =>
      Object.fromEntries(
        recents.map((f) => [
          f.path,
          { lastOpenedAt: f.lastOpened, openCount: 1 },
        ]),
      ),
    [recents],
  );
  return selector({ entries });
}
