# C9 Local Core runtime architecture

## Runtime boundary

Development runs Vite and Local Core independently. Vite owns UI transforms and
HMR only, and proxies `/api` to Local Core. Local Core owns Fastify, native macOS
operations, Workspace runtimes, metadata and filesystem watchers. Production has
no Vite dependency: Local Core serves the built static UI and API on one origin.

## Workspace ownership

One canonical Workspace root maps to one `WorkspaceRuntime`. A runtime owns one
`WorkspaceFileIndex` and one `WorkspaceWatchHub`. SSE connections subscribe to
the hub and do not create OS watchers. Events carry monotonic IDs and revisions;
clients reconcile from a tree snapshot when an event stream cannot be replayed.

## Client ownership

TanStack Query owns fetched disk snapshots and invalidation. Zustand owns UI
session and Tiptap drafts. Workspace connectivity is explicit:
`closed → opening → ready → reconnecting → ready|failed`. Re-registration uses
the remembered absolute root when a process-local Workspace handle expires.

## Metadata ownership

Desktop session files remain desktop-owned. Web state is written to
`.maek/sessions/web/<browser-session-id>/`. Legacy `.maek/tabs.json` and
`.maek/recentFiles.json` can be imported but are never overwritten by the web
client. Workspace content and `.maek/assets` remain shared.

## Acceptance evidence

- UI HMR and Core restarts have independent process lifecycles.
- Production serves the built UI and API from one Local Core process.
- Multiple subscribers to one root share one WatchHub.
- Web session writes leave desktop `tabs.json` byte-for-byte unchanged.
- Hash/mtime optimistic saves and atomic replacement continue protecting notes.
- Typecheck, unit/integration tests, build and browser E2E pass.
