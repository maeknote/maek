import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathInlineView } from "../../components/math-inline";

const MATH_INLINE_DOM_TAG = 'span[data-type="mathInline"]';
const INLINE_MATH_INPUT_RULE = /\$([^$\n]+?)\$$/;

export function createMathInlineContent(latex = "", startInEditMode = false) {
  return {
    type: "mathInline",
    attrs: {
      latex,
      startInEditMode,
    },
  } as const;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface MarkdownItToken {
  type: string;
  tag: string;
  nesting: number;
  content: string;
}

interface MarkdownItRenderer {
  rules: Record<string, (tokens: MarkdownItToken[], index: number) => string>;
}

interface MarkdownItStateInline {
  pos: number;
  posMax: number;
  src: string;
  push(type: string, tag: string, nesting: number): MarkdownItToken;
}

interface MarkdownItLike {
  inline: {
    ruler: {
      before(
        beforeName: string,
        ruleName: string,
        rule: (state: MarkdownItStateInline, silent: boolean) => boolean,
      ): void;
    };
  };
  renderer: MarkdownItRenderer;
  __maekMathInlineInstalled?: boolean;
}

function findInlineMathEnd(src: string, start: number, max: number): number {
  for (let pos = start; pos < max; pos += 1) {
    if (src[pos] !== "$") continue;
    if (src[pos - 1] === "\\") continue;
    if (/\s/.test(src[pos - 1] ?? "")) continue;
    return pos;
  }

  return -1;
}

function installMathInlinePlugin(markdownit: MarkdownItLike): void {
  if (markdownit.__maekMathInlineInstalled) {
    return;
  }

  markdownit.__maekMathInlineInstalled = true;

  markdownit.inline.ruler.before("emphasis", "math_inline", (state, silent) => {
    const start = state.pos;
    if (state.src[start] !== "$") return false;
    if (state.src[start + 1] === "$") return false;
    if (/\s/.test(state.src[start + 1] ?? "")) return false;

    const end = findInlineMathEnd(state.src, start + 1, state.posMax);
    if (end === -1) return false;

    const latex = state.src.slice(start + 1, end);
    if (!latex.trim()) return false;

    if (!silent) {
      const token = state.push("math_inline", "span", 0);
      token.content = latex;
    }

    state.pos = end + 1;
    return true;
  });

  markdownit.renderer.rules.math_inline = (tokens, index) => {
    const latex = tokens[index]?.content ?? "";
    return `<span data-type="mathInline" data-latex="${escapeHtmlAttribute(latex)}"></span>`;
  };
}

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: "",
      },
      startInEditMode: {
        default: false,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: MATH_INLINE_DOM_TAG,
        getAttrs: (element) => ({
          latex: (element as HTMLElement).getAttribute("data-latex") ?? "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const {
      latex,
      startInEditMode: _startInEditMode,
      ...restHTMLAttributes
    } = HTMLAttributes;

    return [
      "span",
      mergeAttributes(restHTMLAttributes, {
        "data-type": "mathInline",
        "data-latex": typeof latex === "string" ? latex : "",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  },

  addInputRules() {
    return [
      new InputRule({
        find: INLINE_MATH_INPUT_RULE,
        handler: ({ chain, match, range }) => {
          const latex = typeof match[1] === "string" ? match[1] : "";
          chain()
            .deleteRange(range)
            .insertContent(createMathInlineContent(latex, true))
            .run();
        },
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: import("prosemirror-markdown").MarkdownSerializerState,
          node: import("@tiptap/pm/model").Node,
        ) {
          const latex =
            typeof node.attrs.latex === "string" ? node.attrs.latex : "";
          state.write(`$${latex}$`);
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            installMathInlinePlugin(markdownit);
          },
        },
      },
    };
  },
});
