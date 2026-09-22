---
name: maek-custom-page
description: Create or migrate self-contained HTML/JavaScript dashboards, trackers, and editors that run under Maek's manifest-discovered Custom Page Runtime, using shared JSON/text file APIs without a separate server or central registration. Not for core React UI features or apps that require secrets, OS commands, or background services.
---

# Maek Custom Page

Build each custom page as an independent folder while using Maek for safe file access.

- Keep UI, calculations, validation, and editing behavior in the page's HTML/JavaScript.
- Use Maek only for declared file reads, version checks, backups, and writes.
- Do not add a page-specific Fastify route, provider, or central registry entry.
- Do not start a separate Python or Node server for ordinary JSON/text editing.

## Module layout

Use a layout like this:

```text
my-app/
├── index.html
├── app.js                 optional
├── maek.page.json
└── data.json
```

Place `maek.page.json` beside the entry HTML. If several independent HTML apps share one folder,
use `<entry-file>.maek.json` beside each entry instead.

Maek discovers manifests in this order when an HTML file is opened:

1. `<opened-html>.maek.json`
2. `maek.page.json` in the same directory
3. No manifest: retain the ordinary static HTML preview

There is no other registration step. The manifest's `entry` must match the HTML being opened.

## Manifest

```json
{
  "schemaVersion": 1,
  "id": "my-app",
  "title": "My App",
  "entry": "index.html",
  "assetsRoot": ".",
  "resources": {
    "data": {
      "path": "data.json",
      "format": "json",
      "access": "read-write",
      "maxBytes": 1000000,
      "backup": { "keep": 20 }
    }
  }
}
```

Manifest and resource paths are relative to the manifest directory.

- `id`: lowercase letters, digits, and hyphens; keep it unique within the workspace.
- `entry`: the HTML file Maek should mount.
- `assetsRoot`: directory whose static HTML/JS/CSS/image assets may be served.
- `resources`: logical API names mapped to actual data files.
- `format`: `json` or `text`.
- `access`: `read` or `read-write`; it defaults to `read`.
- `maxBytes`: defaults to 1 MiB and cannot exceed 8 MiB.
- `backup.keep`: defaults to 20; use `0` only when backups are intentionally unnecessary.

All declared resources must already exist and be regular files when the page mounts. Paths cannot be
absolute, contain `..`, use backslashes, enter `.maek`, or resolve outside the workspace. Data
resources cannot be symlinks. Static files under `assetsRoot` are readable by the page, so do not put
secrets there.

## Shared page API

Call these URLs relative to the mounted page. Use `_api/...`, not `/_api/...`; a leading slash loses
the page's mount path.

### Health

```js
const health = await fetch("_api/health").then((response) => response.json());
```

### Read a resource

```js
const response = await fetch("_api/resources/data", { cache: "no-store" });
if (!response.ok) throw new Error((await response.json()).message);
const version = response.headers.get("ETag");
const data = await response.json(); // use response.text() for text resources
```

Remember each resource's `ETag`. It is the `baseVersion` required for the next write.

### Write one resource

```js
const response = await fetch("_api/resources/data", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ baseVersion: version, content: data }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.message || result.error);
version = result.versions.data;
```

Writable JSON content must be an object or array. Text content must be a string.

### Write several resources together

Use a transaction when one logical save changes multiple files, such as a source JSON document and a
derived Markdown view.

```js
const response = await fetch("_api/transaction", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    writes: [
      { resource: "view", baseVersion: versions.view, content: renderedText },
      { resource: "data", baseVersion: versions.data, content: data },
    ],
  }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.message || result.error);
Object.assign(versions, result.versions);
```

A transaction accepts at most 16 distinct resources. Maek verifies every version before replacing any
file, creates backups, and attempts to restore already-replaced files if a later replacement fails.

## Conflict behavior

If another process changed a resource after the page read it, Maek returns `409 conflict`. Do not
retry automatically and do not invent a force-overwrite path. Preserve the user's draft if possible,
tell them to reload the latest data, and let them reapply the change.

Other useful error codes include `read_only`, `resource_not_found`, `mount_not_found`, `too_large`,
`invalid_json`, and `invalid_text`.

## Implementation workflow

1. Inspect the app's existing files and identify its source data and derived outputs.
2. Keep domain behavior in the module. Do not move ordinary editing logic into Maek's server.
3. Add the smallest manifest resource allowlist the app needs.
4. Load each resource once during startup and retain its ETag.
5. Use a single-resource PUT or multi-resource transaction as appropriate.
6. Show actionable loading, read-only, conflict, and save-error states in the page.
7. Open the HTML in Maek; no central registration or restart-specific configuration is required.

Add a central Maek capability only if the app truly requires privileged behavior such as secrets, OS
commands, external administrator credentials, or a long-running background job. Ask before expanding
the runtime for such a case; never load arbitrary workspace code into the Maek server.

## Validation

Test with disposable copies rather than real user data.

- Confirm the page mounts and reports writable health.
- Read every declared resource and retain its ETag.
- Save, reload, and verify persistence and backup creation.
- Externally change a copied resource and verify stale save returns 409.
- Confirm undeclared resource names return 404 from the page API and the manifest itself is not served
  as a static asset. Remember that ordinary files under `assetsRoot` are intentionally readable assets.
- For multi-file saves, verify every output and its backup.
- Run `npm run typecheck`, the relevant Vitest test, and a focused Playwright test.

For runtime changes rather than a new app, read
[`docs/custom-page-runtime-design.md`](../../../docs/custom-page-runtime-design.md),
[`shared/custom-page.ts`](../../../shared/custom-page.ts), and
[`server/custom-pages/index.ts`](../../../server/custom-pages/index.ts) before editing.
