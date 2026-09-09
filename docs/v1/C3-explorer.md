# C3 — Explorer

Depends on C1/C2. `client/src/features/explorer/Explorer.tsx` adapts original row layout
and react-arborist 3.4.3. Apply the original react-arborist package patch on postinstall.

Acceptance: recursive virtualized tree, selection, expansion, keyboard navigation,
inline rename, new Markdown/folder, duplicate, copy/paste, multi-item drag moves,
Finder file/directory import, refresh, Finder reveal, native Trash.
Rename/move updates active and inactive tabs, recent-file paths and scroll positions.
Reject moving a folder into itself or descendants. Copy collisions use numbered names.
Deletion requires confirmation and successful save; no permanent-delete API is exposed.
Metadata paths and ignored dependency trees are absent from the user tree.
Tests: host CRUD/path tests, browser rename/duplicate/move/delete flow, large-tree DOM check.
Rollback: UI/host source revert; moved files remain in their last user-selected locations.
