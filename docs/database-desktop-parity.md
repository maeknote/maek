# Desktop database and workspace settings parity

## Source and boundaries

Reference: `../maeknote-app`, commit `a9786d6086bb18acdcb84f70463c1e61a92cc680`.

The web database uses the desktop renderer's four view components, view switcher,
cell editors, column/row menus, filter and sort controls, aggregation, calendar
layout, timeline date arithmetic, and `@hello-pangea/dnd` board. The desktop
`window.api` calls are replaced by a typed HTTP adapter in `features/database/api.ts`.
The small database registry store adapts the desktop hook to the web workspace.
The note popup uses the existing web Markdown editor and conflict-aware autosave.

The `.maek` dashboard reproduces `MaekWorkspaceDashboard`: workspace description,
saved tabs/groups, recent-file counts and per-file removal, folder appearance,
and reset actions. The source deliberately omits generic setting-file panels for
`.maek`; those panels belong to other settings kinds. Claude configuration and
skills remain outside this port.

## Shared source of truth

- `.maek/config.json`: managed description/name merged into the existing document.
  A raw-content baseline detects concurrent configuration edits.
- `.maek/tabs.json`: desktop version 4. File, database and `.maek` settings tabs are
  shared; unknown fields, meeting tabs, groups and split information survive normal
  writes. Explicit Clear Saved Tabs resets the entire shared session after saving
  live drafts. Popup editors are never persisted as tabs.
- `.maek/recentFiles.json`: desktop version 1, absolute-path keys, `lastOpenedAt`
  and `openCount`. Opens/removals/clear are server operations, not background
  whole-list snapshots. Existing web session records are merged once using maximum
  timestamps and counts; source files are retained. The migration marker is
  `.maek/migrations/shared-recents-v1.json`.
- `.maek/folder-appearance.json`: shared desktop document.
- `<database>/.maek-database.json`: shared schema and named views.
- Markdown frontmatter: row values; note bodies and unrelated YAML are retained.
- `.maek/database.sqlite`: desktop-compatible registry, row ids and manual ordering.
  Legacy view configurations are retained when creating named views/manifests.

Theme, sidebar layout and browser scroll remain presentation state under
`.maek/sessions/web/<session>/ui.json`; they do not own database or recent-file data.

## Operations and synchronization

`POST /api/databases/command` handles named views, schemas, cells, row insertion,
rename/delete/reorder, kanban drops, sync and unregister. Commands are serialized
per workspace. View/schema changes require the version actually observed by the
client. Row snapshots carry hashes for detecting stale edits. Kanban writes the
field and order in one server request and returns authoritative rows; hidden rows
are retained. No Value removes the frontmatter key.

`POST /api/databases/convert` registers an existing folder. Unregister removes
only the manifest and registry entry. Folder renames retain the database id and
update the registry and manifest name.

Managed metadata is watched separately from the file tree. Its watcher uses
polling to handle atomic replacement consistently on macOS. Database reads avoid
unchanged SQLite writes, preventing self-triggered refresh loops. Row drag flows
suspend refetch and reconcile after completion or cancellation.

Filesystem and SQLite are separate stores; this is not an OS transaction across
both resources. Atomic note replacement still has the same small cross-process
check-to-rename window documented for regular note saves. Desktop and web should
not intentionally edit the same value concurrently.

## Verification

- Host regression tests cover cross-lane drops/No Value, hidden ordering, inserted
  rows, stable row ids, stale view rejection, folder conversion/rename/unregister,
  shared recent counts, one-time migration, config conflicts and shared tab reset.
- Ported helper tests cover date-type preservation, range movement/clamping,
  cross-week overlapping calendar events, typed filtering, sorting and aggregation.
- Browser coverage exercises all four views, note popup save, shared DB-tab reload,
  Home navigation, and the existing editor/file workflows. Shared reset and
  description persistence are covered by host tests.
- Browser screenshots are inspected for all views and the dashboard. A preexisting
  Tailwind opacity conversion bug was fixed because it made calendar/timeline
  event backgrounds transparent.

Original uncommitted user changes were retained. The pre-port diff was captured
at `/tmp/maek-port-baseline/preexisting.diff` for local comparison.


## Note state and loading regression fixes (2026-09-30)

- Heading collapse state persists per workspace and browser profile in
  `.maek/sessions/web/<profile>/editor.json`. Note patches merge under a server
  lock; same-profile windows share live changes through BroadcastChannel.
  Renames remap note paths, and deletion removes saved collapse keys.
- Popup saves flush property drafts before serialization. First body edits keep
  the YAML closing fence on its own line. Save requests are serialized even when
  input flushing yields, and title rename/close waits for the current save.
  Save failures retain the draft. Already-damaged notes are not rewritten.
- All database views share a TanStack Query row snapshot. Switching selects the
  view before metadata persistence completes, including successive switches.
  View commands omit rows and skip note scans; file changes invalidate the shared
  rows. Own view-setting SQLite writes do not trigger another row scan.
- Runtime snapshots cache parsed YAML and hashes using nanosecond mtime/ctime,
  size and file identity. Reads use bounded concurrency; row-index writes use
  one SQLite transaction. Conflict-sensitive writes still read current files.

### Measurements

Synthetic folders contained 100 or 1,000 notes of approximately 2.8 KB. Server
measurements used 10 warm repetitions against the previous HEAD implementation
and the changed implementation on the same machine. Initial load starts with an
empty application cache; OS filesystem caches may already be warm.

| Notes | Operation | Before median / p95 | After median / p95 |
| --- | --- | --- | --- |
| 100 | Row sync | 14.5 / 18.7 ms | 2.3 / 2.8 ms |
| 100 | View command | 14.2 / 16.4 ms | 0.9 / 1.2 ms |
| 1,000 | Row sync | 137.5 / 147.0 ms | 16.6 / 22.8 ms |
| 1,000 | View command | 134.5 / 158.0 ms | 1.5 / 1.7 ms |

Initial server row loads were 29.3 → 5.9 ms (100 notes) and
183.3 → 42.5 ms (1,000 notes).

Browser tests use a simpler three-property fixture and 10 alternating table /
kanban switches. The clock runs inside Chromium from click through two animation
frames; separate assertions verify the new view appears. Tracing is disabled for
this measurement because DOM snapshots distort large-list latency.

| Notes | Initial visible note | Switch median / p95 | Switch row-sync requests |
| --- | --- | --- | --- |
| 100 | 193 ms | 86 / 181 ms | 0 |
| 1,000 | 1,135 ms | 1,820 / 2,191 ms | 0 |

These UI measurements have no pre-change browser baseline. Views still render all
cards/rows, so 1,000-note rendering remains more expensive than server work;
virtualized rendering is not implemented by this change.

Validation: `npm run check`; 300 unit/host tests; 21 relevant browser tests.
New browser coverage includes Cmd+S, property/title Enter, immediate close,
failed-save draft retention, session restart, same-profile window sharing,
duplicate headings, note rename and delayed view persistence.
