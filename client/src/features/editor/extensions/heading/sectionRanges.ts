import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface TopLevelBlockInfo {
  index: number;
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  node: ProseMirrorNode;
  level?: 1 | 2 | 3;
}

export interface HeadingBlockInfo extends TopLevelBlockInfo {
  level: 1 | 2 | 3;
}

export interface HeadingSectionRange {
  heading: HeadingBlockInfo;
  contentBlocks: TopLevelBlockInfo[];
  contentFrom: number | null;
  contentTo: number | null;
}

export function getTopLevelBlocks(doc: ProseMirrorNode): TopLevelBlockInfo[] {
  const blocks: TopLevelBlockInfo[] = [];

  doc.forEach((node, offset, index) => {
    const from = offset;
    const to = from + node.nodeSize;
    const level =
      node.type.name === "heading" &&
      (node.attrs.level === 1 ||
        node.attrs.level === 2 ||
        node.attrs.level === 3)
        ? (node.attrs.level as 1 | 2 | 3)
        : undefined;

    blocks.push({
      index,
      from,
      to,
      contentFrom: from + 1,
      contentTo: to - 1,
      node,
      level,
    });
  });

  return blocks;
}

export function isCollapsibleHeadingBlock(
  block: TopLevelBlockInfo,
): block is HeadingBlockInfo {
  if (block.node.type.name !== "heading") {
    return false;
  }

  const level = block.node.attrs.level;
  return level === 1 || level === 2 || level === 3;
}

export function getHeadingSectionRange(
  doc: ProseMirrorNode,
  headingPos: number,
): HeadingSectionRange | null {
  const blocks = getTopLevelBlocks(doc);
  const headingIndex = blocks.findIndex((block) => block.from === headingPos);

  if (headingIndex === -1) {
    return null;
  }

  const headingBlock = blocks[headingIndex]!;
  if (!isCollapsibleHeadingBlock(headingBlock)) {
    return null;
  }

  const contentBlocks: TopLevelBlockInfo[] = [];

  for (let index = headingIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index]!;

    if (isCollapsibleHeadingBlock(block) && block.level <= headingBlock.level) {
      break;
    }

    contentBlocks.push(block);
  }

  return {
    heading: headingBlock,
    contentBlocks,
    contentFrom: contentBlocks[0]?.from ?? null,
    contentTo: contentBlocks.at(-1)?.to ?? null,
  };
}
