# C4 — Tiptap editor

Depends on C1/C2. Import the source lockfile's Tiptap 3 packages, tiptap-markdown 0.9.0,
original heading, task list, code, table, math, image, link and slash extensions.
Original TableOverlay, BubbleToolbar, LinkHoverMenu, HeadingRail, TitleBar,
FrontmatterPanel and associated NodeViews supply the editing presentation.

Save after 1500ms idle, Cmd+S, blur and tab switch. Serialize saves per file and server
Workspace. Check both content hash and mtime and atomically replace only after validation.
Do not rewrite a file merely because Tiptap normalizes its Markdown on open.
Frontmatter unknown properties survive. Invalid YAML is visible and blocks saving.
Original syntax handling (including setext normalization behavior) follows upstream.
Images imported by paste/drop/file selection live in `.maek/assets` and use relative links.

Acceptance: existing Markdown opens, real edits save to the original path, navigation
during in-flight saves preserves the latest edit, table/math/task/code/image/link controls work.
Tests: browser rich-editor and save-race scenarios; filesystem hash/mtime tests.
Rollback: source revert only; no destructive format migration.
