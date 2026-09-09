import { Heading } from "@tiptap/extension-heading";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  getHeadingSectionRange,
  getTopLevelBlocks,
  isCollapsibleHeadingBlock,
} from "./sectionRanges";

interface HeadingCollapsePluginState {
  collapsedHeadingPositions: number[];
}

interface HeadingToggleMeta {
  type: "toggle";
  headingPos: number;
}

interface HeadingRestoreMeta {
  type: "restore";
  collapsedHeadingPositions: number[];
}

type HeadingPluginMeta = HeadingToggleMeta | HeadingRestoreMeta;

export const HEADING_TOGGLE_PLUGIN_KEY =
  new PluginKey<HeadingCollapsePluginState>("collapsibleHeading");

function isCollapsedHeadingPosition(
  doc: ProseMirrorNode,
  pos: number,
): boolean {
  const section = getHeadingSectionRange(doc, pos);
  return section !== null;
}

function mapCollapsedHeadingPositions(
  doc: ProseMirrorNode,
  positions: number[],
  tr: Transaction,
): number[] {
  const nextPositions: number[] = [];

  for (const position of positions) {
    const mapped = tr.mapping.mapResult(position, 1);
    if (mapped.deleted || !isCollapsedHeadingPosition(doc, mapped.pos)) {
      continue;
    }

    if (!nextPositions.includes(mapped.pos)) {
      nextPositions.push(mapped.pos);
    }
  }

  return nextPositions;
}

function moveSelectionOutOfCollapsedContent(
  view: EditorView,
  headingPos: number,
): void {
  const section = getHeadingSectionRange(view.state.doc, headingPos);
  if (!section || section.contentFrom === null || section.contentTo === null) {
    return;
  }

  const { selection } = view.state;
  const intersectsHiddenContent =
    selection.from < section.contentTo && selection.to > section.contentFrom;

  if (!intersectsHiddenContent) {
    return;
  }

  const transaction = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, headingPos + 1))
    .scrollIntoView();

  view.dispatch(transaction);
}

function toggleHeadingSection(view: EditorView, headingPos: number): void {
  const pluginState = HEADING_TOGGLE_PLUGIN_KEY.getState(view.state);
  const collapsedHeadingPositions =
    pluginState?.collapsedHeadingPositions ?? [];
  const isCollapsed = collapsedHeadingPositions.includes(headingPos);

  if (!isCollapsed) {
    moveSelectionOutOfCollapsedContent(view, headingPos);
  }

  view.dispatch(
    view.state.tr.setMeta(HEADING_TOGGLE_PLUGIN_KEY, {
      type: "toggle",
      headingPos,
    } satisfies HeadingToggleMeta),
  );
}

function createToggleButton(
  view: EditorView,
  headingPos: number,
  collapsed: boolean,
): HTMLButtonElement {
  const button = document.createElement("button");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

  button.type = "button";
  button.className = "maek-heading-toggle";
  button.contentEditable = "false";
  button.dataset.state = collapsed ? "collapsed" : "expanded";
  button.setAttribute(
    "aria-label",
    collapsed ? "Expand section" : "Collapse section",
  );
  button.setAttribute("aria-expanded", collapsed ? "false" : "true");

  icon.setAttribute("viewBox", "0 0 12 12");
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("maek-heading-toggle-icon");

  path.setAttribute("d", "M4 2.5L7.5 6L4 9.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "1.4");

  icon.append(path);
  button.append(icon);

  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleHeadingSection(view, headingPos);
  });

  return button;
}

function buildHeadingDecorations(
  doc: ProseMirrorNode,
  collapsedHeadingPositions: number[],
): DecorationSet {
  const decorations: Decoration[] = [];
  const collapsedSet = new Set(collapsedHeadingPositions);
  const blocks = getTopLevelBlocks(doc);
  const hiddenBlockKeys = new Set<string>();

  for (const block of blocks) {
    if (!isCollapsibleHeadingBlock(block)) {
      continue;
    }

    const section = getHeadingSectionRange(doc, block.from);
    if (!section) {
      continue;
    }

    const isCollapsed = collapsedSet.has(block.from);

    decorations.push(
      Decoration.widget(
        section.heading.contentFrom,
        (view) => createToggleButton(view, block.from, isCollapsed),
        {
          side: -1,
          key: `heading-toggle-${block.from}-${isCollapsed ? "collapsed" : "expanded"}`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    );
  }

  for (const headingPos of collapsedHeadingPositions) {
    const section = getHeadingSectionRange(doc, headingPos);
    if (!section) {
      continue;
    }

    for (const contentBlock of section.contentBlocks) {
      const hiddenBlockKey = `${contentBlock.from}:${contentBlock.to}`;
      if (hiddenBlockKeys.has(hiddenBlockKey)) {
        continue;
      }

      hiddenBlockKeys.add(hiddenBlockKey);
      decorations.push(
        Decoration.node(
          contentBlock.from,
          contentBlock.to,
          {
            class: "maek-collapsed-heading-content",
          },
          {
            hiddenByHeading: headingPos,
          },
        ),
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

function createCollapsibleHeadingPlugin(): Plugin<HeadingCollapsePluginState> {
  return new Plugin<HeadingCollapsePluginState>({
    key: HEADING_TOGGLE_PLUGIN_KEY,
    state: {
      init: () => ({
        collapsedHeadingPositions: [],
      }),
      apply(tr, pluginState) {
        let collapsedHeadingPositions = mapCollapsedHeadingPositions(
          tr.doc,
          pluginState.collapsedHeadingPositions,
          tr,
        );

        const meta = tr.getMeta(HEADING_TOGGLE_PLUGIN_KEY) as
          HeadingPluginMeta | undefined;
        if (!meta) {
          return { collapsedHeadingPositions };
        }

        if (meta.type === "restore") {
          const validPositions = meta.collapsedHeadingPositions.filter((pos) =>
            isCollapsedHeadingPosition(tr.doc, pos),
          );
          return { collapsedHeadingPositions: validPositions };
        }

        if (meta.type !== "toggle") {
          return { collapsedHeadingPositions };
        }

        if (!isCollapsedHeadingPosition(tr.doc, meta.headingPos)) {
          return { collapsedHeadingPositions };
        }

        if (collapsedHeadingPositions.includes(meta.headingPos)) {
          collapsedHeadingPositions = collapsedHeadingPositions.filter(
            (position) => position !== meta.headingPos,
          );
        } else {
          collapsedHeadingPositions = [
            ...collapsedHeadingPositions,
            meta.headingPos,
          ].sort((a, b) => a - b);
        }

        return { collapsedHeadingPositions };
      },
    },
    props: {
      decorations(state) {
        const pluginState = HEADING_TOGGLE_PLUGIN_KEY.getState(state);
        return buildHeadingDecorations(
          state.doc,
          pluginState?.collapsedHeadingPositions ?? [],
        );
      },
    },
  });
}

export const MaekHeading = Heading.extend({
  addOptions() {
    const parentOptions = this.parent?.();

    return {
      ...parentOptions,
      levels: [1, 2, 3],
      HTMLAttributes: parentOptions?.HTMLAttributes ?? {},
    };
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createCollapsibleHeadingPlugin()];
  },
});
