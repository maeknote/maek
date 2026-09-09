# V1 implementation evidence

Source baseline: maeknote-app a9786d6. Imported original design CSS/components,
Tiptap extensions/NodeViews, heading/table utilities, fuzzy search and arborist patch.

- C1: real path-based host and .maek metadata implemented; host/guard/file tests pass.
- C2: original visual sources imported; light/dark browser screenshots captured.
- C3: arborist tree, rename/duplicate/move/trash integration passes browser tests.
- C4: rich Tiptap editing, save-race protection and untouched-file preservation pass browser tests.
- C5: tabs, search, relative links, frontmatter, recent Workspaces, session/scroll/theme restoration implemented.
- C6: external changes/conflicts and inode-based rename tracking pass browser tests.
- C7: text/unsupported/browser image/PDF paths implemented; automated native-boundary tests pass.
- C8: legacy UI/store/routes/sample data removed. Automated integration checks pass.
- C9: Vite/Core development lifecycles split; production Local Core static serving,
  root-scoped WatchHub/FileIndex, event revisions, reconnect state, TanStack Query
  disk snapshots and browser-session metadata isolation implemented.

## Final automated run — 2026-09-09

- `npm run typecheck`: passed.
- `npm test`: 67 tests passed across 5 files.
- `npm run build`: passed; the editor bundle still produces the >500 kB chunk warning.
- `npm run test:e2e`: 9 browser scenarios passed.
- `git diff --check`: passed.

Browser coverage: existing nested notes and Korean editing; session/theme restore;
external updates and dirty conflicts; picker cancellation without an empty JSON body;
original file search; text/unsupported previews; tree rename/duplicate/move/Trash
transport; table/math/task/code/image/frontmatter; delayed-save tab navigation;
unchanged Markdown bytes/mtime after opening; original `[[` picker and encoded links.
The tree suite also verifies that selecting a previously unopened note creates and
activates a second tab after the first tab was restored from legacy
`.maek/tabs.json`. New web state is persisted under `.maek/sessions/web`.
Screenshots: `test-results/v1-editor-light.png`, `test-results/v1-editor-dark.png`.

Final regressions fixed: readiness changes no longer emit Tiptap document updates
(which falsely marked untouched notes dirty); original file-picker keyboard selectors
and listbox semantics are corrected; workspace links are decoded exactly once.

## Remaining desktop evidence

Desktop evidence still required for real Finder dialog, Trash and default-app launch.
Automated tests substitute these side effects and verify transport/arguments.
No full original-vs-port 2% pixel-difference measurement has been made. These manual
acceptance criteria remain open; automated success does not establish exact visual parity.

Deletion record: removed repo-local .maek-data containing one UUID sample Markdown,
databases.json and empty history directory, as requested. No external Workspace files
were removed. This sample deletion did not retain a backup.
