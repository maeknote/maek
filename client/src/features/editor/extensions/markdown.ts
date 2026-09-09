import { Markdown } from "tiptap-markdown";

interface MarkdownItLike {
  disable: (rule: string | string[]) => void;
}

interface MarkdownParserLike {
  md: MarkdownItLike;
  parse: (content: string, options?: { inline?: boolean }) => unknown;
}

/**
 * Wrapper around `tiptap-markdown`'s Markdown extension that disables
 * setext heading parsing (`lheading` rule in markdown-it).
 *
 * Why: a paragraph immediately followed by an empty bullet line `- ` is
 * interpreted by CommonMark as a setext H2 — the `-` becomes the heading
 * underline and the previous paragraph turns into a heading on round-trip.
 * This app only ever writes ATX headings (`#`, `##`, `###`), so disabling
 * setext is lossless and prevents the empty-bullet-to-heading round-trip
 * bug. Affects both initial content parsing and clipboard paste, since
 * both paths share `editor.storage.markdown.parser.md`.
 */
export const MaekMarkdown = Markdown.extend({
  onBeforeCreate(event): void {
    this.parent?.(event);
    const storage = (this.editor.storage as unknown as Record<string, unknown>)
      .markdown as {
      parser: MarkdownParserLike;
    };
    storage.parser.md.disable("lheading");
    // Parent already parsed `editor.options.initialContent` once with
    // setext enabled, so re-parse with the patched parser before the
    // editor view reads `options.content`.
    const options = this.editor.options as {
      initialContent?: unknown;
      content?: unknown;
    };
    if (typeof options.initialContent === "string") {
      options.content = storage.parser.parse(options.initialContent);
    }
  },
});
