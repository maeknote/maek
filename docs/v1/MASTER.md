# Maek Note V1 migration

Source: maeknote-app a9786d6. Host: React 19, Vite, Fastify, macOS localhost.
Approved scope: original visual components; Tiptap 3 with original extensions;
react-arborist tree; real Markdown files; .maek workspace metadata; file operations,
search, tabs, session restoration, native picker, watcher, read-only previews.
Excluded: databases, meetings, AI, terminal, Electron packaging, Windows/Linux.

## Orchestration

| Work | Depends on | Completion evidence |
| --- | --- | --- |
| [C1 Filesystem bridge](C1-filesystem.md) | — | path containment, recursive scan, CRUD and metadata integration tests |
| [C2 Design import](C2-design.md) | — | original source components and CSS, light/dark browser inspection |
| [C3 Explorer](C3-explorer.md) | C1,C2 | react-arborist, nested tree, rename/move/copy/import/trash |
| [C4 Editor](C4-editor.md) | C1,C2 | original Tiptap extensions, round trip, Korean input and save |
| [C5 Convenience](C5-convenience.md) | C3,C4 | tabs, search, links, frontmatter, images, session/scroll restore |
| [C6 Watcher](C6-watcher.md) | C1,C4 | external add/change/delete, reconnect, dirty conflict protection |
| [C7 Preview](C7-preview.md) | C1,C2 | images/PDF/text, unsupported/default-app |
| [C8 Integration](C8-integration.md) | C3–C7 | no legacy APIs or auto-created data, tests/typecheck/build/E2E |

Follow dependency order; C8 only completes when integrated behavior passes.
Preserve unrelated worktree changes. Never delete a user's ordinary notes/history
directory by name: remove only positively identified legacy app data.
No automated source syncing after V1. Record copied source provenance in this file.

## Invariants

Files retain real names and locations. No UUID note schema or catalog is injected.
Workspace operations use relative paths and existing realpath containment checks.
Metadata stays in .maek; localStorage only locates the last workspace.
Save compares hash and mtime; a conflict never silently overwrites external edits.
Deletion uses macOS Trash. No startup operation destroys files.
Host binds to loopback and rejects foreign origins. Unsupported HTML is never executed.

## Validation

Run npm run typecheck, npm test, npm run build and npm run test:e2e.
Fixtures must contain nested pre-existing Markdown and non-Markdown files, not
app-created UUID notes. Verify disk bytes after save and external changes.
Native picker/trash/default app need a macOS smoke check; automated tests inject
these OS boundaries without showing dialogs or trashing real user files.
