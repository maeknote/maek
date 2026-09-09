# C1 — Workspace / filesystem host

Depends on: none. Implemented in `server/host.ts`, `server/fs/*`, `shared/workspace.ts`.
Use React/Vite + Fastify on loopback, macOS native picker through an argv-based OS adapter.

## Contract

Every file endpoint requires `X-Workspace-Id`; paths are Workspace-relative.
`POST /api/workspaces/open {path}` and `/pick` establish the Workspace handle.
`GET /api/tree` returns `{nodes,warnings}`; nodes have id/name/parent/isDir.
`GET /api/files/content?path=…` returns kind/content/hash/mtimeMs/size.
`PUT /api/files/content {path,content,baseHash,baseMtimeMs}` performs an atomic save.
Create: `POST /api/files {dir,name,kind}`. Move: `PATCH /api/files/path {source,dest}`.
Copy: `POST /api/files/copy {paths,dir}`. Import: `POST /api/files/import {dir,files:[{name,data}]}` (base64).
Trash: `DELETE /api/files {paths}`. External open: `POST /api/files/open-external {path,reveal?}`.

## Acceptance

Recursive arbitrary existing files, directories first, original heavy-directory exclusions.
No symlink traversal, no parent escape, no overwrites on create/copy/move/import.
All application metadata goes in `.maek`, using original config/versioned tab/recent-file shapes.
Only the last Workspace pointer is in browser localStorage. Corrupt metadata uses defaults.
Same-origin and loopback checks remain; malformed/empty JSON retains a 400 status.
Tests: `tests/host.test.ts`, existing path guard and optimistic-save unit tests.
Rollback: revert host code; user Markdown remains at its original path. Do not automatically remove existing Workspace files.
