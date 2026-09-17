# maek

A personal Markdown workspace app that runs on macOS localhost.
It ports Maek Note's design components, Tiptap editor extensions, and the react-arborist tree.

## Running

Runs on Node.js 22.12+ or 24+.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000 and use Open Folder to pick an existing folder.
`npm run dev` runs the UI/HMR (:3000) and the Local Core (:3001) as independent
processes. For regular use, run `npm run build && npm start`; in that mode a
single Local Core serves both the built UI and the file API.

### Desktop icon (macOS)

After building, run the command below once to create `Maek.app` on your Desktop.
Clicking the icon starts the server with `npm start` and opens the browser. If a
server is already running, it opens the existing window instead of creating a new one.

```sh
npm run build
npm run install:desktop
```

Inside the app you can shut down the local server via Settings (⌘,) → **Quit server**.
If you move the project folder elsewhere, run `npm run install:desktop` again.

If the native window is unavailable, enter an absolute path in Enter folder path.
You can switch the Workspace from Settings or the sidebar folder menu.
The next run restores the last Workspace and tabs.

## Files and metadata

```text
Selected Workspace/
  Existing note.md
  My folder/Nested note.md
  .maek/
    config.json
    tabs.json
    assets/Pasted image.png
    sessions/web/<browser session>/ui.json
    sessions/web/<browser session>/recentFiles.json
```

Actual file names and locations are preserved. It does not auto-create
`.maek-data`, `notes/`, `history/`, or `databases.json`. The open-tab list and
order are shared through the workspace-root `.maek/tabs.json` (the original app's
version 4 format) as a single source of truth, and changes made by the desktop
app are reflected in the web in real time. The web app manages file, database,
and workspace-settings tabs, and preserves original-only tab/group/split
information and unknown fields through merge saves. Presentation state such as
theme, sidebar width, expansion, scroll, and selected tab is stored per browser
session in `ui.json`, while recent files are stored with view counts in the
app-shared `.maek/recentFiles.json`. It reads and writes the original Maek Note's
version 4 tab and version 1 recent-file structures identically to the app.
Existing per-web-session recent files are merged once. Browser localStorage stores
only the last path and the recent Workspaces used for display. Ordinary `notes`
and `history` folders are treated as user files and are never auto-deleted.

It saves 1.5 seconds after an edit, on tab switch, on window blur, and on Cmd+S.
It checks the file hash and modification time, then replaces the file atomically.
On a conflict with an external edit, it keeps the local edits and offers Reload,
Save a copy, and Close. If unsaved edits exist, it warns before closing the window.
It does not use OS file locks to block the extremely brief race in which an
external program writes just before the atomic replacement.

## Features

- Original Tiptap tables, code, math, checklists, heading folding, slash menu, and selection toolbar
- YAML frontmatter raw/property editing, internal note links, image insert/paste
- Recursive virtualized tree, new note/folder, rename, drag to move, duplicate, copy/paste
- Finder drop import, Reveal in Finder, Move to macOS Trash
- Multiple tabs, tab reordering, quick file search, recent files, Workspace/scroll/theme restore
- Real-time reflection of external file changes and renames, unsaved-conflict protection
- Read-only preview for images, PDF, and text; sandboxed HTML artifacts that also read neighboring JS/CSS/JSON; open unsupported formats in the default app
- HTML artifact refresh and open in browser
- CSV spreadsheet editing: virtualized grid, cell/row/column editing, range selection, Excel/Google Sheets-compatible copy/paste, undo/redo, sort/filter/find/selection stats
- App-shared folder databases: table/kanban/calendar/timeline views, named views, column formats/aggregation, multi-sort/filter, drag to move rows/columns/cards/periods

CSV stores string values only and does not support colors, cell formatting,
formula calculation, or multiple sheets. It edits UTF-8 (including BOM) CSV up to
5 MiB, 50,000 rows, 200 columns, and 500,000 fields. Larger CSVs open read-only to
protect the original. Databases use the folder's `.maek-database.json`, Markdown
frontmatter, and the workspace's `.maek/database.sqlite`, identically to the app.
Meetings, AI, and the terminal are not supported. Markdown becomes read-only above
1 MiB, and text is treated as unsupported above 32 MiB. Symbolic links and the
original's dependency/build-cache folders are excluded from traversal.

## Shortcuts and verification

Cmd+P/O search, Cmd+N new note, Cmd+S save, Cmd+W close tab, Cmd+, settings.
In the tree, Cmd+C/V copy/paste, Cmd+D duplicate, Cmd+Backspace Trash.
In the CSV grid, use Cmd+C/X/V for range copy/cut/paste and Cmd+Z/Shift+Cmd+Z for undo/redo.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

For the current runtime boundaries and data-preservation rules, see the
[architecture document](docs/architecture.md).

For the porting scope and storage rules of database and workspace settings, see the
[porting document](docs/database-desktop-parity.md).
