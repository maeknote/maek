import Fuse, { type FuseResultMatch, type IFuseOptions } from "fuse.js";
import type { FileNode } from "@shared/types";

export const SEARCH_TUNING = {
  threshold: 0.3,
  minMatchCharLength: 2,
  nameWeight: 0.7,
  pathWeight: 0.3,
  emptyStateRecentsLimit: 20,
} as const;

export interface IndexedFile extends FileNode {
  _path: string;
}

export interface RankedResult {
  file: FileNode;
  score: number;
  matches: readonly FuseResultMatch[];
}

export function indexFiles(
  files: FileNode[],
  getRelativePath: (f: FileNode) => string,
): IndexedFile[] {
  return files.map((f) => {
    const rel = getRelativePath(f);
    return { ...f, _path: rel ? `${rel}/${f.name}` : f.name };
  });
}

const FUSE_OPTIONS: IFuseOptions<IndexedFile> = {
  keys: [
    { name: "name", weight: SEARCH_TUNING.nameWeight },
    { name: "_path", weight: SEARCH_TUNING.pathWeight },
  ],
  includeMatches: true,
  includeScore: true,
  threshold: SEARCH_TUNING.threshold,
  ignoreLocation: true,
  minMatchCharLength: SEARCH_TUNING.minMatchCharLength,
};

export function createFuse(indexed: IndexedFile[]): Fuse<IndexedFile> {
  return new Fuse(indexed, FUSE_OPTIONS);
}

export function scoreFiles(
  fuse: Fuse<IndexedFile>,
  query: string,
  getRecencyScore?: (fileId: string) => number,
): RankedResult[] {
  const q = query.trim();
  if (!q) return [];
  const raw = fuse.search(q).map((r) => ({
    file: r.item as FileNode,
    score: r.score ?? 1,
    matches: r.matches ?? [],
  }));
  if (!getRecencyScore) return raw;
  // Tiebreaker: when fuse scores are (near-)equal, prefer higher recency.
  // Threshold 1e-6 catches Fuse's stable-sort ties without blending scores.
  raw.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-6) return a.score - b.score;
    return getRecencyScore(b.file.id) - getRecencyScore(a.file.id);
  });
  return raw;
}

export function getNameMatchIndices(
  matches: readonly FuseResultMatch[],
): Array<[number, number]> {
  const nameMatch = matches.find((m) => m.key === "name");
  return nameMatch
    ? nameMatch.indices.map(([s, e]) => [s, e + 1] as [number, number])
    : [];
}

export function getPathMatchIndices(
  matches: readonly FuseResultMatch[],
  relativePath: string,
): Array<[number, number]> {
  const pathMatch = matches.find((m) => m.key === "_path");
  if (!pathMatch || !relativePath) return [];
  const out: Array<[number, number]> = [];
  for (const [s, e] of pathMatch.indices) {
    const end = e + 1;
    if (end <= relativePath.length) out.push([s, end]);
  }
  return out;
}
