# C8 — Legacy removal and verification

Depends on C3–C7. Remove old LibraryStore, UUID schema, note/database UI and routes,
old design wrappers and old catalog-based tests. Keep reusable guard/frontmatter/file
unit tests. Retain the empty-JSON-request regression in the replacement browser suite.

Delete only positively identified `.maek-data` contents authorized by the user;
never scan other Workspaces deleting folders named notes/history.
No startup or Workspace open creates notes/history/databases.json.

Required checks: typecheck, unit/integration tests, production build, browser E2E.
Evidence covers arbitrary pre-existing nested notes; native picker transport; real disk
save; external events/conflicts; rename/copy/move/trash; rich editing; previews;
session restoration; no console exceptions; original UI screenshots in both themes.
Full original-app pixel comparison and native desktop dialogs need separately recorded
desktop evidence before claiming those specific acceptance criteria.

Rollback: source revert. Deleted legacy sample data has no migration path; real
Workspace Markdown and original .maek metadata are preserved.
