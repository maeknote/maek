# C2 — Original design components

Depends on: none. Source: maeknote-app a9786d6 renderer.

Import `shared/design` tokens, CSS, Button, Header, PanelIcon, FloatingMenu,
MenuItem, Toast, FolderSelector and editor presentation components directly.
Inject original CSS at `client/src/main.tsx`. Tailwind uses original configuration;
the accent opacity adapter maps CSS variables to color-mix for opacity utilities.
Host layout uses original sidebar, tab, title, breadcrumb, editor and menu styling.
Native Electron chrome and unsupported feature panels are excluded.

Acceptance: light/dark themes use original tokens; no old design provider or notes CSS
is reachable. Use original 28px tree rows, 12px indentation, 34px tabs and editor CSS.
Evidence: imported source provenance, build and browser screenshots. Full original-app
pixel difference <=2% remains a separate visual verification, not inferred from source reuse.
Rollback: restore client entry point and UI source; no disk data changes.
