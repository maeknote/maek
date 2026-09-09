import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getTopLevelBlocks, isCollapsibleHeadingBlock } from "./sectionRanges";

export function buildHeadingKey(
  level: number,
  text: string,
  occurrenceIndex: number,
): string {
  return `h${level}:${text}:${occurrenceIndex}`;
}

export function buildDocumentHeadingKeyMap(
  doc: ProseMirrorNode,
): Map<number, string> {
  const blocks = getTopLevelBlocks(doc);
  const keyMap = new Map<number, string>();
  const occurrenceCounts = new Map<string, number>();

  for (const block of blocks) {
    if (!isCollapsibleHeadingBlock(block)) continue;

    const text = block.node.textContent.trim();
    const baseKey = `h${block.level}:${text}`;
    const count = occurrenceCounts.get(baseKey) ?? 0;
    occurrenceCounts.set(baseKey, count + 1);

    keyMap.set(block.from, buildHeadingKey(block.level, text, count));
  }

  return keyMap;
}

export function resolveKeysToPositions(
  doc: ProseMirrorNode,
  keys: string[],
): number[] {
  if (keys.length === 0) return [];

  const keySet = new Set(keys);
  const keyMap = buildDocumentHeadingKeyMap(doc);
  const positions: number[] = [];

  for (const [pos, key] of keyMap) {
    if (keySet.has(key)) {
      positions.push(pos);
    }
  }

  return positions.sort((a, b) => a - b);
}
