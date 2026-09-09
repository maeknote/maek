import { useState, useCallback, type ReactElement } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  FileText,
} from "lucide-react";
import { LinkInput } from "./LinkInput";
import { useNotePickerStore } from "../../stores/notePickerStore";
import { getDisplayName } from "../../utils/displayName";
import { workspaceHref } from "@renderer/lib/pathUtils";
import type { FileNode } from "@shared/workspace";

interface BubbleToolbarProps {
  editor: Editor;
  notePath: string;
}

export function BubbleToolbar({
  editor,
  notePath,
}: BubbleToolbarProps): ReactElement | null {
  const [showLinkInput, setShowLinkInput] = useState(false);

  // Subscribe to editor state so active marks update reactively on selection change
  const activeStates = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
    }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shouldShow = useCallback(
    ({ state, from }: { state: any; from: number }) => {
      const { selection } = state;
      const { empty } = selection;

      // Don't show on empty selection
      if (empty) return false;

      // Don't show for node selections (images, etc.)
      if (selection.node) return false;

      // Don't show for cell selections (tables)
      if (selection.constructor.name === "CellSelection") return false;

      // Don't show inside code blocks
      const $from = state.doc.resolve(from);
      if ($from.parent.type.name === "codeBlock") return false;

      return true;
    },
    [],
  );

  const handleLinkClick = useCallback(() => {
    if (activeStates?.link) {
      editor.chain().focus().unsetLink().run();
    } else {
      setShowLinkInput(true);
    }
  }, [editor, activeStates?.link]);

  const handleLinkToNote = useCallback(() => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to);
    const coords = editor.view.coordsAtPos(from);

    useNotePickerStore
      .getState()
      .open({ x: coords.left, y: coords.bottom + 8 }, (file: FileNode) => {
        const href = workspaceHref(notePath, file.id);
        const linkText =
          selectedText ||
          (file.isDatabase ? file.name : getDisplayName(file.name));
        editor
          .chain()
          .focus()
          .setTextSelection({ from, to })
          .command(({ tr }) => {
            if (!selectedText) {
              tr.insertText(linkText, from, to);
            }
            return true;
          })
          .setTextSelection({
            from,
            to: from + (selectedText || linkText).length,
          })
          .setLink({ href })
          .run();
      });
  }, [editor, notePath]);

  if (!activeStates) return null;

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={shouldShow}
      options={{
        placement: "top",
        offset: 8,
        flip: { padding: 16 },
        shift: { padding: 16 },
        onHide: () => setShowLinkInput(false),
      }}
    >
      <div className="maek-bubble-toolbar">
        {showLinkInput ? (
          <LinkInput editor={editor} onClose={() => setShowLinkInput(false)} />
        ) : (
          <>
            <button
              className={`maek-bubble-btn ${activeStates.bold ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleBold().run()}
              aria-label="Bold"
            >
              <Bold />
            </button>
            <button
              className={`maek-bubble-btn ${activeStates.italic ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              aria-label="Italic"
            >
              <Italic />
            </button>
            <button
              className={`maek-bubble-btn ${activeStates.strike ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              aria-label="Strikethrough"
            >
              <Strikethrough />
            </button>
            <button
              className={`maek-bubble-btn ${activeStates.code ? "active" : ""}`}
              onClick={() => editor.chain().focus().toggleCode().run()}
              aria-label="Inline Code"
            >
              <Code />
            </button>
            <div className="maek-bubble-divider" />
            <button
              className={`maek-bubble-btn ${activeStates.link ? "active" : ""}`}
              onClick={handleLinkClick}
              aria-label="Link"
            >
              <Link />
            </button>
            <button
              className="maek-bubble-btn"
              onClick={handleLinkToNote}
              aria-label="Link to Note"
            >
              <FileText />
            </button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
