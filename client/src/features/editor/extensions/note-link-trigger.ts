import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { useNotePickerStore } from "../stores/notePickerStore";
import { workspaceHref } from "@renderer/lib/pathUtils";
import { getDisplayName } from "../utils/displayName";
import type { FileNode } from "@shared/workspace";
import type { EditorView } from "@tiptap/pm/view";

const noteLinkTriggerKey = new PluginKey("noteLinkTrigger");

interface NoteLinkTriggerOptions {
  notePath: string;
}

function insertNoteLink(
  view: EditorView,
  targetFile: FileNode,
  notePath: string,
): void {
  const linkText = targetFile.isDatabase
    ? targetFile.name
    : getDisplayName(targetFile.name);
  const href = workspaceHref(notePath, targetFile.id);
  const { state } = view;
  const { from } = state.selection;

  const linkMark = state.schema.marks.link!.create({ href });
  const textNode = state.schema.text(linkText, [linkMark]);
  const endPos = from + textNode.nodeSize;
  const tr = state.tr.insert(from, textNode);
  tr.setSelection(TextSelection.create(tr.doc, endPos));
  view.dispatch(tr);
  view.focus();
}

export const NoteLinkTrigger = Extension.create<NoteLinkTriggerOptions>({
  name: "noteLinkTrigger",

  addOptions() {
    return {
      notePath: "",
    };
  },

  addProseMirrorPlugins() {
    const notePath = this.options.notePath;

    return [
      new Plugin({
        key: noteLinkTriggerKey,

        props: {
          handleTextInput(view, from, to, text) {
            // Only trigger on '[' input
            if (text !== "[") return false;

            const { state } = view;
            const $from = state.doc.resolve(from);

            // Don't trigger inside code blocks or inline code
            if ($from.parent.type.name === "codeBlock") return false;
            const marks = state.storedMarks ?? $from.marks();
            if (
              marks.some(
                (m: { type: { name: string } }) => m.type.name === "code",
              )
            )
              return false;

            // Check if the character before is also '['
            const posInParent = from - $from.start();
            if (posInParent < 1) return false;

            const charBefore = $from.parent.textContent[posInParent - 1];
            if (charBefore !== "[") return false;

            // Delete both '[' characters: the existing one and the one being typed
            view.dispatch(state.tr.delete(from - 1, to));

            // Get cursor screen coordinates from the new state after dispatch
            const newFrom = view.state.selection.from;
            const coords = view.coordsAtPos(newFrom);

            // Open the NotePicker
            useNotePickerStore
              .getState()
              .open({ x: coords.left, y: coords.bottom }, (file: FileNode) => {
                insertNoteLink(view, file, notePath);
              });

            return true;
          },
        },
      }),
    ];
  },
});
