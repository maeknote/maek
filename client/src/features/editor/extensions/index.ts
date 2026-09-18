import { Extension, type AnyExtension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { MaekMarkdown } from "./markdown";
import TaskItem from "@tiptap/extension-task-item";
import { MaekTaskList } from "./taskListMarkdown";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { MaekLink } from "./link";
import { MaekTable } from "./table";
import { MaekCodeBlock } from "./code-block";
import { TaskListShortcut } from "./taskListInputRule";
import { SlashCommand } from "./slash-command";
import type { SlashCommandRunProps } from "./slash-command/slashCommandItems";
import { TypographyRules } from "./typographyRules";
import { MathBlock } from "./math-block";
import { MathInline } from "./math-inline";
import { MaekHeading } from "./heading";
import { MaekImage } from "./image";
import { NoteLinkTrigger } from "./note-link-trigger";

interface EditorExtensionConfig {
  notePath: string;
  onSelectImage?: (props: SlashCommandRunProps) => void | Promise<void>;
  onLinkToNote?: (props: SlashCommandRunProps) => void | Promise<void>;
}

const StrikeShortcut = Extension.create({
  name: "strikeShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
    };
  },
});

export function getEditorExtensions(
  config: EditorExtensionConfig,
): AnyExtension[] {
  return [
    StrikeShortcut,
    StarterKit.configure({
      link: false,
      heading: false,
      codeBlock: false, // Use CodeBlockLowlight instead
      dropcursor: { color: "var(--color-accent)", width: 2 },
    }),
    MaekHeading,
    Placeholder.configure({
      placeholder: "Type '/' for commands...",
    }),
    MaekMarkdown.configure({
      html: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
    // Task list (checklist) extensions
    MaekTaskList,
    TaskItem.configure({
      nested: true,
    }),
    TaskListShortcut,
    // Table extensions (MAEK custom table with no manual resize)
    MaekTable,
    TableRow,
    TableHeader,
    TableCell,
    // Code block with syntax highlighting + copy button
    MaekCodeBlock,
    MathInline,
    MathBlock,
    MaekImage.configure({
      notePath: config.notePath,
    }),
    // Link extension (extended with note link detection)
    MaekLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        rel: "noopener noreferrer",
        target: null,
      },
    }),
    // Typography auto-replacements (-> → →, <- → ←)
    TypographyRules,
    // [[ trigger for note linking
    NoteLinkTrigger.configure({
      notePath: config.notePath,
    }),
    // Slash command menu
    SlashCommand.configure({
      onSelectImage: config.onSelectImage,
      onLinkToNote: config.onLinkToNote,
    }),
  ];
}
