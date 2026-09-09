import TiptapImage from "@tiptap/extension-image";
import type { Editor, Range } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { defaultMarkdownSerializer } from "prosemirror-markdown";
import { ImageView } from "../../components/image/ImageView";

interface MarkdownImageOptions {
  notePath?: string;
}

interface PlaceholderAddPayload {
  id: string;
  pos: number;
}

interface PlaceholderRemovePayload {
  id: string;
}

type PlaceholderMeta =
  | {
      add: PlaceholderAddPayload;
      remove?: never;
    }
  | {
      add?: never;
      remove: PlaceholderRemovePayload;
    };

export const noteImagePlaceholderPluginKey = new PluginKey<DecorationSet>(
  "noteImagePlaceholder",
);

function resolveImageInsertionRange(editor: Editor, anchorPos: number): Range {
  const imageType = editor.schema.nodes.image!;
  const $pos = editor.state.doc.resolve(anchorPos);

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (!node.isBlock) continue;

    const parent = $pos.node(depth - 1);
    const index = $pos.index(depth);
    const blockFrom = $pos.before(depth);
    const blockTo = $pos.after(depth);

    const canReplaceEmptyBlock =
      node.isTextblock &&
      node.content.size === 0 &&
      parent.canReplaceWith(index, index + 1, imageType);

    if (canReplaceEmptyBlock) {
      return { from: blockFrom, to: blockTo };
    }

    const canInsertAfterBlock = parent.canReplaceWith(
      index + 1,
      index + 1,
      imageType,
    );
    if (canInsertAfterBlock) {
      return { from: blockTo, to: blockTo };
    }
  }

  return { from: anchorPos, to: anchorPos };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    noteImage: {
      insertImportedImages: (options: {
        anchorId: string;
        images: Array<{ src: string; alt?: string; title?: string }>;
      }) => ReturnType;
    };
  }
}

function createPlaceholderElement(): HTMLElement {
  const element = document.createElement("span");
  element.className = "maek-note-image-placeholder";
  element.textContent = "Importing image...";
  return element;
}

export function addNoteImagePlaceholder(
  editor: Editor,
  {
    id,
    range,
    insertPos,
  }: { id: string; range?: Range; insertPos?: number | null },
): void {
  let transaction = editor.state.tr;
  let targetPos = insertPos ?? editor.state.selection.from;

  if (range) {
    transaction = transaction.deleteRange(range.from, range.to);
    targetPos = range.from;
  }

  transaction = transaction.setMeta(noteImagePlaceholderPluginKey, {
    add: { id, pos: targetPos },
  } satisfies PlaceholderMeta);

  editor.view.dispatch(transaction);
}

export function removeNoteImagePlaceholder(editor: Editor, id: string): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(noteImagePlaceholderPluginKey, {
      remove: { id },
    } satisfies PlaceholderMeta),
  );
}

export function findNoteImagePlaceholderPos(
  editor: Editor,
  id: string,
): number | null {
  const decorations = noteImagePlaceholderPluginKey.getState(editor.state);
  if (!decorations) return null;

  const found = decorations.find(
    undefined,
    undefined,
    (spec) => spec.id === id,
  );
  return found[0]?.from ?? null;
}

function createPlaceholderPlugin() {
  return new Plugin({
    key: noteImagePlaceholderPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let nextSet = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(noteImagePlaceholderPluginKey) as
          PlaceholderMeta | undefined;
        if (!meta) {
          return nextSet;
        }

        if (meta.add) {
          const decoration = Decoration.widget(
            meta.add.pos,
            () => createPlaceholderElement(),
            {
              id: meta.add.id,
              side: -1,
            },
          );
          nextSet = nextSet.add(tr.doc, [decoration]);
        }

        if (meta.remove) {
          const decorations = nextSet.find(
            undefined,
            undefined,
            (spec) => spec.id === meta.remove.id,
          );
          nextSet = nextSet.remove(decorations);
        }

        return nextSet;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

export const MaekImage = TiptapImage.extend<MarkdownImageOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      inline: false,
      allowBase64: false,
      notePath: "",
      HTMLAttributes: {},
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createPlaceholderPlugin()];
  },

  addStorage() {
    return {
      markdown: {
        serialize: defaultMarkdownSerializer.nodes.image,
        parse: {
          // Standard markdown image parsing is handled by tiptap-markdown.
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      insertImportedImages:
        ({ anchorId, images }) =>
        ({ editor, commands }) => {
          const anchorPos = findNoteImagePlaceholderPos(editor, anchorId);
          if (anchorPos == null) {
            return false;
          }

          const insertionRange = resolveImageInsertionRange(editor, anchorPos);
          const content = [
            ...images.map((image) => ({
              type: "image",
              attrs: {
                src: image.src,
                alt: image.alt ?? "",
                title: image.title ?? null,
              },
            })),
            { type: "paragraph" },
          ];

          return commands.insertContentAt(insertionRange, content);
        },
    };
  },
});
