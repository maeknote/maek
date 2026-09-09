# C7 — Preview / OS bridge

Depends on C1/C2. Editable kinds: .md/.markdown <=1 MiB. Larger valid UTF-8 Markdown
is read-only. Text decoding is capped at 32 MiB; binary/NUL/invalid UTF-8 is unsupported.
Images and PDF use a protected streaming endpoint. Known text/code extensions use a
read-only text view. HTML, Office, databases and other formats use an unsupported page.

Acceptance: raw HTML is never rendered in the app. Raw endpoints only serve image/PDF
with no-sniff and sandbox CSP. Unsupported pages offer explicit OS default-app open.
OS operations resolve paths under the current Workspace and execute argv, not shell strings.
Native calls are macOS-only; automated tests inject the native boundaries.
Tests: API classification/security and browser read-only/unsupported/image flows.
Rollback: UI source revert; no document conversion or write is performed.
