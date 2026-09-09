# C6 — File events / conflicts

Depends on C1/C4. Chokidar watches the selected root with native events, no symlink
following. SSE transfers add/change/unlink/addDir/unlinkDir and inode-correlated rename.
Initial watcher readiness and reconnection request a full rescan to close event gaps.
Metadata and temporary files do not trigger user-tree refresh loops.

Acceptance: external file/folder additions, modifications, renames and deletions update
the tree. Clean active tabs reload; dirty tabs keep local edits and stop automatic saves.
Conflict actions are reload (explicit discard), save a copy, or close (explicit discard).
Server shutdown, Workspace switch and connection close release watchers/timers.
Tests: browser external modification conflict and external rename flows.
Rollback: source revert; watcher never owns note contents or rewrites external edits.
