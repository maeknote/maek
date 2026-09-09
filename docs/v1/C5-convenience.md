# C5 — Note convenience

Depends on C3/C4. Open/close/switch/reorder tabs, close others/all, middle-click close,
breadcrumb-to-tree focus, editable file title and copy Markdown. Cmd+P/O opens fuzzy
search with original Fuse scoring and recent-file tiebreaking. Cmd+N creates a note.
Cmd+W closes an editor tab. Cmd+, opens Workspace settings.

Persist tabs, active tab, scroll and tree expansion in `.maek/tabs.json` with original
versioned tab records. Store original recent-file entries in `.maek/recentFiles.json`.
Workspace history goes in `.maek/workspaces.json`; only the last path is in localStorage.
Light/dark theme and sidebar size persist per Workspace. Missing tabs are not resurrected.
`[[` and toolbar/slash link-to-note controls open a file picker; links use encoded relative paths.
Before browser unload warn if edits remain unsaved. Failed saves retain visible local edits.

Acceptance: browser reload restores active note, theme, tree and scroll. Search opens
an existing nested file; move/rename updates tab paths. UI exposes no database/meeting/AI actions.
Rollback: source revert; original app can still read versioned metadata.
