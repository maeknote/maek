import type { Editor, Range } from "@tiptap/core";
import { createMathBlockContent } from "../math-block";
import {
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  FileText,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Table,
  Code2,
  Minus,
  Sigma,
  type LucideIcon,
} from "lucide-react";

export interface SlashCommandRunProps {
  editor: Editor;
  range: Range;
  insertPos?: number;
}

export interface SlashCommandItemOptions {
  onSelectImage?: (props: SlashCommandRunProps) => void | Promise<void>;
  onLinkToNote?: (props: SlashCommandRunProps) => void | Promise<void>;
}

export interface SlashCommandItem {
  title: string;
  description: string;
  searchTerms: string[];
  icon: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  badge?: string;
  run: (props: SlashCommandRunProps) => void | Promise<void>;
}

export function createSlashCommandItems(
  options: SlashCommandItemOptions,
): SlashCommandItem[] {
  const items: SlashCommandItem[] = [
    {
      title: "Heading 1",
      description: "Large heading",
      searchTerms: ["h1", "heading", "title"],
      icon: Heading1,
      shortcut: "#",
      run: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleHeading({ level: 1 })
          .run();
      },
    },
    {
      title: "Heading 2",
      description: "Medium heading",
      searchTerms: ["h2", "heading", "subtitle"],
      icon: Heading2,
      shortcut: "##",
      run: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleHeading({ level: 2 })
          .run();
      },
    },
    {
      title: "Heading 3",
      description: "Small heading",
      searchTerms: ["h3", "heading"],
      icon: Heading3,
      shortcut: "###",
      run: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleHeading({ level: 3 })
          .run();
      },
    },
    {
      title: "Bullet List",
      description: "Unordered list",
      searchTerms: ["bullet", "list", "ul"],
      icon: List,
      shortcut: "-",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: "Ordered List",
      description: "Numbered list",
      searchTerms: ["ordered", "number", "list", "ol"],
      icon: ListOrdered,
      shortcut: "1.",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    {
      title: "Task List",
      description: "Checklist with checkboxes",
      searchTerms: ["task", "todo", "checklist", "checkbox"],
      icon: ListChecks,
      shortcut: "[]",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    {
      title: "Quote",
      description: "Blockquote",
      searchTerms: ["quote", "blockquote"],
      icon: Quote,
      shortcut: ">",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      title: "Table",
      description: "3x3 table",
      searchTerms: ["table", "grid"],
      icon: Table,
      run: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      },
    },
    {
      title: "Code Block",
      description: "Code with syntax highlighting",
      searchTerms: ["code", "codeblock", "pre"],
      icon: Code2,
      shortcut: "```",
      run: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setCodeBlock({ language: "plaintext" })
          .run();
      },
    },
    {
      title: "Math Block",
      description: "Display math rendered with KaTeX",
      searchTerms: ["math", "equation", "formula", "latex", "katex"],
      icon: Sigma,
      shortcut: "$$",
      run: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(createMathBlockContent(true))
          .run();
      },
    },
    {
      title: "Divider",
      description: "Horizontal rule",
      searchTerms: ["divider", "hr", "horizontal", "rule", "line"],
      icon: Minus,
      shortcut: "---",
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run();
      },
    },
  ];

  items.push({
    title: "Link to Note",
    description: "Insert a link to another note",
    searchTerms: ["link", "note", "reference", "wikilink", "backlink"],
    icon: FileText,
    shortcut: "[[",
    disabled: !options.onLinkToNote,
    badge: options.onLinkToNote ? undefined : "Coming soon",
    run: (props) => options.onLinkToNote?.(props),
  });

  items.push({
    title: "Image",
    description: options.onSelectImage
      ? "Import an image into this note"
      : "Note image import is temporarily unavailable",
    searchTerms: ["image", "photo", "picture", "media", "asset"],
    icon: ImageIcon,
    disabled: !options.onSelectImage,
    badge: options.onSelectImage ? undefined : "Coming soon",
    run: (props) => options.onSelectImage?.(props),
  });

  return items;
}

export function filterSlashItems(
  query: string,
  options: SlashCommandItemOptions,
): SlashCommandItem[] {
  const items = createSlashCommandItems(options);
  if (!query) return items;

  const lowerQuery = query.toLowerCase();

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(lowerQuery)) return true;
    if (item.searchTerms.some((term) => term.includes(lowerQuery))) return true;
    return false;
  });
}
