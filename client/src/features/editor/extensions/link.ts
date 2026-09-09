import Link from "@tiptap/extension-link";
import { isNoteLinkHref } from "@renderer/lib/pathUtils";
import { mergeAttributes } from "@tiptap/core";

export const MaekLink = Link.extend({
  renderHTML({ HTMLAttributes }) {
    const href = HTMLAttributes.href ?? "";
    const isNoteLink = isNoteLinkHref(href);
    const classes = isNoteLink ? "maek-link maek-note-link" : "maek-link";

    return [
      "a",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: classes,
      }),
      0,
    ];
  },
});
