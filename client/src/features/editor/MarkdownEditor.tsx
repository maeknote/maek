import { useEffect, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { getEditorExtensions } from "./extensions";
import { TableOverlay } from "./components/table/TableOverlay";
import { BubbleToolbar } from "./components/bubble-toolbar/BubbleToolbar";
import { LinkHoverMenu } from "./components/link-hover-menu/LinkHoverMenu";
import { HeadingRail } from "./components/HeadingRail";
import { useHeadingCollapseSync } from "./hooks/useHeadingCollapseSync";
import { useNotePickerStore } from "./stores/notePickerStore";
import {
  workspaceHref,
  dirname,
  resolvePath,
  isWorkspaceLinkHref,
} from "../../lib/pathUtils";
import { useStore, schedulePersistence, type Tab } from "../../store";
import { api, toBase64 } from "../../host";
import "./styles/editor.css";

const markdown = (editor: Editor) =>
  (
    editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
export function MarkdownEditor({ tab }: { tab: Tab }) {
  const restoring = useStore((s) => s.restoring);
  const scroll = useRef<HTMLDivElement>(null);
  const notePath = tab.id;
  const imageInput = useRef<HTMLInputElement>(null);
  const imageRange = useRef<{ from: number; to: number } | null>(null);
  async function insertImages(editor: Editor, files: File[]) {
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const result = await api<{ path: string }>("/api/files/image", "POST", {
          name: file.name || "image.png",
          data: await toBase64(file),
        });
        if (imageRange.current) {
          editor.chain().focus().deleteRange(imageRange.current).run();
          imageRange.current = null;
        }
        editor
          .chain()
          .focus()
          .setImage({
            src: workspaceHref(notePath, result.path),
            alt: file.name,
          })
          .run();
      }
    } catch (e) {
      useStore.getState().setError(String(e));
    }
  }
  const editor = useEditor(
    {
      extensions: getEditorExtensions({
        notePath,
        onSelectImage: ({ range }) => {
          imageRange.current = range;
          imageInput.current?.click();
        },
        onLinkToNote: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).run();
          const pos = editor.view.coordsAtPos(editor.state.selection.from);
          useNotePickerStore
            .getState()
            .open({ x: pos.left, y: pos.bottom }, (file) =>
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "text",
                  text: file.name.replace(/\.md$/i, ""),
                  marks: [
                    {
                      type: "link",
                      attrs: { href: workspaceHref(notePath, file.id) },
                    },
                  ],
                })
                .run(),
            );
        },
      }),
      content: tab.bodyContent,
      editorProps: {
        attributes: {
          class: "prose prose-neutral max-w-none focus:outline-none",
          "aria-label": "Markdown editor",
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter(
            (f) => f.type.startsWith("image/"),
          );
          if (!files.length || !editor) return false;
          event.preventDefault();
          void insertImages(editor, files);
          return true;
        },
        handleDrop: (_view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter(
            (f) => f.type.startsWith("image/"),
          );
          if (!files.length || !editor) return false;
          event.preventDefault();
          void insertImages(editor, files);
          return true;
        },
        handleClick: (_view, _pos, event) => {
          const a = (event.target as HTMLElement).closest("a");
          const href = a?.getAttribute("href");
          if (!href) return false;

          event.preventDefault();
          if (isWorkspaceLinkHref(href)) {
            const p = resolvePath(dirname(notePath), href);
            void useStore.getState().openFile(p.replace(/^\//, ""));
          } else {
            // Open any external link, fallback to prepending https:// if needed
            const url = /^https?:\/\//i.test(href) ? href : `https://${href}`;
            window.open(url, "_blank", "noopener,noreferrer");
          }
          return true;
        },
      },
      onCreate: ({ editor }) => {
        const current = useStore.getState().tabs.find((t) => t.id === notePath);
        if (current && current.bodyContent === current.savedBodyContent)
          useStore.getState().rebase(notePath, markdown(editor));
      },
      onUpdate: ({ editor }) =>
        useStore.getState().updateBody(notePath, markdown(editor)),
    },
    [notePath, tab.generation],
  );
  useHeadingCollapseSync(editor, notePath);
  // Toggling workspace readiness must not count as a document edit.
  useEffect(() => {
    editor?.setEditable(!restoring, false);
  }, [editor, restoring]);
  useEffect(() => {
    if (editor && scroll.current) {
      scroll.current.scrollTop =
        useStore.getState().scrollPositions[notePath] ?? 0;
    }
  }, [editor, notePath]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void useStore.getState().save(notePath);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [notePath]);
  if (!editor) return null;
  return (
    <div className="maek-editor-pane">
      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void insertImages(editor, Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <div
        className="maek-editor-scroll"
        ref={scroll}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          useStore.setState((s) => ({
            scrollPositions: { ...s.scrollPositions, [notePath]: top },
          }));
          schedulePersistence();
        }}
      >
        <EditorContent editor={editor} className="h-full" />
        <BubbleToolbar editor={editor} notePath={notePath} />
        <LinkHoverMenu editor={editor} notePath={notePath} />
        <TableOverlay editor={editor} />
      </div>
      <HeadingRail editor={editor} scrollContainerRef={scroll} />
    </div>
  );
}
