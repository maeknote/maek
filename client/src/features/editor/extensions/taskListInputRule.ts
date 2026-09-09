import { Extension } from "@tiptap/core";
import { InputRule } from "@tiptap/core";

/**
 * Custom input rule: typing `[] ` at the start of a line creates a task list.
 * This supplements TipTap's built-in `[ ] ` and `[x] ` input rules.
 */
export const TaskListShortcut = Extension.create({
  name: "taskListShortcut",

  addInputRules() {
    return [
      // Match `[]` followed by a space at the beginning of a line
      new InputRule({
        find: /^\[\]\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).toggleTaskList().run();
        },
      }),
    ];
  },
});
