import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathBlockView } from "../../components/math-block";

const MATH_BLOCK_DOM_TAG = 'div[data-type="mathBlock"]';
const MATH_BLOCK_TRIGGER = /^\$\$\s$/;

export function createMathBlockContent(startInEditMode = false) {
  return {
    type: "mathBlock",
    attrs: {
      latex: "",
      startInEditMode,
    },
  } as const;
}

function normalizeMathLatex(latex: string): string {
  return latex.replace(/^\n+/, "").replace(/\n+$/, "");
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
  block: boolean;
  markup: string;
  map: [number, number] | null;
  content: string;
}

interface MarkdownItStateBlock {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  sCount: number[];
  blkIndent: number;
  parentType: string;
  line: number;
  push(type: string, tag: string, nesting: number): MarkdownItToken;
  skipSpaces(pos: number): number;
  getLines(
    begin: number,
    end: number,
    indent: number,
    keepLastLF: boolean,
  ): string;
}

interface MarkdownItRenderer {
  rules: Record<string, (tokens: MarkdownItToken[], index: number) => string>;
}

interface MarkdownItLike {
  block: {
    ruler: {
      before(
        beforeName: string,
        ruleName: string,
        rule: (
          state: MarkdownItStateBlock,
          startLine: number,
          endLine: number,
          silent: boolean,
        ) => boolean,
      ): void;
    };
  };
  renderer: MarkdownItRenderer;
  __maekMathBlockInstalled?: boolean;
}

function isStandaloneMathFence(line: string): boolean {
  return line.trim() === "$$";
}

function parseSingleLineMath(line: string): string | null {
  const trimmed = line.trim();
  if (
    !trimmed.startsWith("$$") ||
    !trimmed.endsWith("$$") ||
    trimmed === "$$"
  ) {
    return null;
  }

  return trimmed.slice(2, -2);
}

function installMathBlockPlugin(markdownit: MarkdownItLike): void {
  if (markdownit.__maekMathBlockInstalled) {
    return;
  }

  markdownit.__maekMathBlockInstalled = true;

  markdownit.block.ruler.before(
    "fence",
    "math_block",
    (state, startLine, endLine, silent) => {
      const start = state.bMarks[startLine]! + state.tShift[startLine]!;
      const max = state.eMarks[startLine];
      const firstLine = state.src.slice(start, max);

      if (!firstLine.trim().startsWith("$$")) {
        return false;
      }

      const singleLineMath = parseSingleLineMath(firstLine);
      if (singleLineMath !== null) {
        if (silent) {
          return true;
        }

        const token = state.push("math_block", "div", 0);
        token.block = true;
        token.markup = "$$";
        token.map = [startLine, startLine + 1];
        token.content = normalizeMathLatex(singleLineMath);
        state.line = startLine + 1;
        return true;
      }

      if (!isStandaloneMathFence(firstLine)) {
        return false;
      }

      let nextLine = startLine + 1;

      for (; nextLine < endLine; nextLine += 1) {
        const lineStart = state.bMarks[nextLine]! + state.tShift[nextLine]!;
        const lineEnd = state.eMarks[nextLine];
        const lineText = state.src.slice(lineStart, lineEnd);

        if (!isStandaloneMathFence(lineText)) {
          continue;
        }

        if (silent) {
          return true;
        }

        const content = state.getLines(startLine + 1, nextLine, 0, false);
        const token = state.push("math_block", "div", 0);
        token.block = true;
        token.markup = "$$";
        token.map = [startLine, nextLine + 1];
        token.content = normalizeMathLatex(content);
        state.line = nextLine + 1;
        return true;
      }

      return false;
    },
  );

  markdownit.renderer.rules.math_block = (tokens, index) => {
    const latex = normalizeMathLatex(tokens[index]?.content ?? "");
    return `<div data-type="mathBlock" data-latex="${escapeHtmlAttribute(latex)}"></div>`;
  };
}

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,

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
        tag: MATH_BLOCK_DOM_TAG,
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
      "div",
      mergeAttributes(restHTMLAttributes, {
        "data-type": "mathBlock",
        "data-latex": typeof latex === "string" ? latex : "",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },

  addInputRules() {
    return [
      new InputRule({
        find: MATH_BLOCK_TRIGGER,
        handler: ({ chain, range }) => {
          chain()
            .deleteRange(range)
            .insertContent(createMathBlockContent(true))
            .run();
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-m": () =>
        this.editor
          .chain()
          .focus()
          .insertContent(createMathBlockContent(true))
          .run(),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: import("prosemirror-markdown").MarkdownSerializerState,
          node: import("@tiptap/pm/model").Node,
        ) {
          const latex = normalizeMathLatex(
            typeof node.attrs.latex === "string" ? node.attrs.latex : "",
          );
          state.write("$$\n");
          if (latex.length > 0) {
            state.write(latex);
            state.ensureNewLine();
          }
          state.write("$$");
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownItLike) {
            installMathBlockPlugin(markdownit);
          },
        },
      },
    };
  },
});
