import TaskList from "@tiptap/extension-task-list";
import taskListPlugin from "markdown-it-task-lists";
import type MarkdownIt from "markdown-it";

type StateCore = {
  tokens: Array<{
    type: string;
    content: string;
    children?: Array<{ type: string; content: string }> | null;
  }>;
};

const EMPTY_TASK = /^\[[ xX]\]$/;

// markdown-it strips the trailing space from `[ ] ` on empty task items, leaving
// `[ ]` — which markdown-it-task-lists rejects because its trigger requires
// `[ ] ` with a space. Re-append the space before that rule runs so empty
// checkboxes round-trip through save/load instead of leaking as literal text.
function fixEmptyTaskItems(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type !== "inline") continue;
    if (!EMPTY_TASK.test(token.content)) continue;
    token.content += " ";
    if (!token.children) continue;
    for (const child of token.children) {
      if (child.type === "text" && EMPTY_TASK.test(child.content)) {
        child.content += " ";
      }
    }
  }
}

const PATCH_FLAG = Symbol.for("maek.taskList.emptyItemFix");

function installEmptyTaskFix(md: MarkdownIt): void {
  const patched = md as MarkdownIt & { [PATCH_FLAG]?: boolean };
  if (patched[PATCH_FLAG]) return;
  patched[PATCH_FLAG] = true;
  md.core.ruler.before(
    "github-task-lists",
    "empty-task-item-fix",
    fixEmptyTaskItems,
  );
}

// CommonMark merges adjacent same-marker lists, so `- bullet\n\n- [ ] task`
// becomes a single `<ul>` where markdown-it-task-lists marks the whole list as
// `contains-task-list`. Tiptap's schema requires a taskList to contain only
// taskItems, so the mixed list corrupts the document. Split any mixed list
// into adjacent pure lists before Tiptap converts the DOM to nodes.
function splitMixedTaskLists(root: HTMLElement): void {
  const doc = root.ownerDocument;
  if (!doc) return;
  const mixedLists = [
    ...root.querySelectorAll<HTMLUListElement>("ul.contains-task-list"),
  ];
  for (const ul of mixedLists) {
    const items = [...ul.children].filter(
      (child): child is HTMLLIElement => child.tagName === "LI",
    );
    if (items.length === 0) continue;
    const hasTask = items.some((li) => li.classList.contains("task-list-item"));
    const hasNonTask = items.some(
      (li) => !li.classList.contains("task-list-item"),
    );
    if (!hasTask || !hasNonTask) continue;

    // Walk children and flush a new <ul> each time the "is task item" flag flips.
    const parent = ul.parentNode;
    if (!parent) continue;
    const fragment = doc.createDocumentFragment();
    let currentUl: HTMLUListElement | null = null;
    let currentIsTask: boolean | null = null;
    for (const li of items) {
      const isTask = li.classList.contains("task-list-item");
      if (currentUl === null || currentIsTask !== isTask) {
        currentUl = doc.createElement("ul");
        if (isTask) currentUl.classList.add("contains-task-list");
        fragment.appendChild(currentUl);
        currentIsTask = isTask;
      }
      currentUl.appendChild(li);
    }
    parent.replaceChild(fragment, ul);
  }
}

export const MaekTaskList = TaskList.extend({
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: MarkdownIt) {
            md.use(taskListPlugin);
            installEmptyTaskFix(md);
          },
          updateDOM(element: HTMLElement) {
            splitMixedTaskLists(element);
            element.querySelectorAll(".contains-task-list").forEach((list) => {
              list.setAttribute("data-type", "taskList");
            });
          },
        },
      },
    };
  },
});
