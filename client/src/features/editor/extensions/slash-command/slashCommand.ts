import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";
import { SlashMenu } from "../../components/slash-menu";
import {
  filterSlashItems,
  type SlashCommandItem,
  type SlashCommandRunProps,
} from "./slashCommandItems";
import type {
  SuggestionProps,
  SuggestionKeyDownProps,
} from "@tiptap/suggestion";

const slashCommandPluginKey = new PluginKey("slashCommand");

interface SlashCommandOptions {
  onSelectImage?: (props: SlashCommandRunProps) => void | Promise<void>;
  onLinkToNote?: (props: SlashCommandRunProps) => void | Promise<void>;
}

function slashMenuRenderer() {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let selectedIndex = 0;
  let currentItems: SlashCommandItem[] = [];
  let currentCommand: ((props: SlashCommandItem) => void) | null = null;
  let isKeyboardNav = false;
  let frameId: number | null = null;

  function cancelScheduledPositionUpdate() {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  }

  function renderMenu() {
    if (!root) return;
    const itemsForRender = currentItems;
    const commandForRender = currentCommand;

    root.render(
      createElement(SlashMenu, {
        items: itemsForRender,
        selectedIndex,
        keyboardNav: isKeyboardNav,
        onSelect: (index: number) => {
          const item = itemsForRender[index];
          if (item && !item.disabled && commandForRender) {
            commandForRender(item);
          }
        },
        onHover: (index: number) => {
          isKeyboardNav = false;
          selectedIndex = index;
          renderMenu();
        },
      }),
    );
  }

  function getFallbackRect(
    props: SuggestionProps<SlashCommandItem>,
  ): DOMRect | null {
    const coords = props.editor.view.coordsAtPos(props.range.from);

    try {
      return new DOMRect(
        coords.left,
        coords.top,
        coords.right - coords.left,
        coords.bottom - coords.top,
      );
    } catch {
      return null;
    }
  }

  function updatePosition(props: SuggestionProps<SlashCommandItem>) {
    if (!container) return;

    const getReferenceRect = props.clientRect ?? (() => getFallbackRect(props));
    const virtualElement = {
      getBoundingClientRect: () =>
        getReferenceRect() ?? getFallbackRect(props) ?? new DOMRect(),
    };

    void computePosition(virtualElement, container, {
      placement: "bottom-start",
      middleware: [offset(8), flip({ padding: 16 }), shift({ padding: 16 })],
    })
      .then(({ x, y }) => {
        if (container) {
          container.style.left = `${x}px`;
          container.style.top = `${y}px`;
        }
      })
      .catch((error) => {
        console.error("[SlashCommand] failed to position menu:", error);
      });
  }

  function schedulePositionUpdate(props: SuggestionProps<SlashCommandItem>) {
    cancelScheduledPositionUpdate();
    frameId = requestAnimationFrame(() => {
      frameId = null;
      updatePosition(props);
    });
  }

  return {
    onStart(props: SuggestionProps<SlashCommandItem>) {
      container = document.createElement("div");
      container.style.position = "fixed";
      container.style.zIndex = "1100";
      document.body.appendChild(container);
      root = createRoot(container);

      currentItems = props.items;
      currentCommand = props.command;
      selectedIndex = 0;

      renderMenu();
      schedulePositionUpdate(props);
    },

    onUpdate(props: SuggestionProps<SlashCommandItem>) {
      currentItems = props.items;
      currentCommand = props.command;
      selectedIndex = 0;

      renderMenu();
      schedulePositionUpdate(props);
    },

    onKeyDown(props: SuggestionKeyDownProps) {
      const { event } = props;
      if (currentItems.length === 0) return false;

      if (event.key === "ArrowUp") {
        isKeyboardNav = true;
        selectedIndex =
          (selectedIndex - 1 + currentItems.length) % currentItems.length;
        renderMenu();
        return true;
      }

      if (event.key === "ArrowDown") {
        isKeyboardNav = true;
        selectedIndex = (selectedIndex + 1) % currentItems.length;
        renderMenu();
        return true;
      }

      if (event.key === "Enter") {
        const item = currentItems[selectedIndex];
        if (item && !item.disabled && currentCommand) {
          currentCommand(item);
        }
        return true;
      }

      return false;
    },

    onExit() {
      cancelScheduledPositionUpdate();
      root?.unmount();
      container?.remove();
      root = null;
      container = null;
      currentItems = [];
      currentCommand = null;
      selectedIndex = 0;
    },
  };
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onSelectImage: undefined,
      onLinkToNote: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        pluginKey: slashCommandPluginKey,
        char: "/",
        allowSpaces: false,
        allowedPrefixes: null,
        startOfLine: false,

        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const nodeType = $from.parent.type.name;

          // Don't trigger inside code blocks
          if (nodeType === "codeBlock") return false;

          // Check that '/' is at start of line or after whitespace
          const slashOffset = range.from - $from.start();
          if (slashOffset === 0) return true;
          const charBefore = $from.parent.textContent[slashOffset - 1];
          return (
            charBefore === " " || charBefore === "\t" || charBefore === "\n"
          );
        },

        items: ({ query }) =>
          filterSlashItems(query, {
            onSelectImage: this.options.onSelectImage,
            onLinkToNote: this.options.onLinkToNote,
          }),

        command: ({ editor, range, props: item }) => {
          void Promise.resolve(item.run({ editor, range })).catch((error) => {
            console.error("[SlashCommand] item execution failed:", error);
          });
        },

        render: () => slashMenuRenderer(),
      }),
    ];
  },
});
