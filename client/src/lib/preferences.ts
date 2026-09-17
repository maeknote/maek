/**
 * Global display preferences.
 *
 * The web app has no login or sync backend, so per-browser display taste
 * (accent color, editor font, size, line-height) is persisted in this
 * browser's `localStorage` only. Theme is intentionally NOT stored here — it
 * lives in the workspace-scoped, app-shared `.maek/sessions/web/<id>/ui.json`
 * so it survives workspace switches like the desktop app.
 *
 * Everything here is defensive: a corrupted or partially-written value must
 * never crash the app. Unknown/invalid fields fall back to defaults, numbers
 * are clamped into range, and the whole payload recovers to defaults when it
 * cannot be parsed at all.
 */

export const PREFERENCES_STORAGE_KEY = "maek:preferences";

/** Accent color options. `id` is stable; it is what we persist. */
export interface AccentColor {
  id: string;
  label: string;
  /** Base accent, maps to `--color-maek-red`. */
  value: string;
  /** Hover accent, maps to `--color-maek-red-hover`. */
  hover: string;
}

export const ACCENT_COLORS: readonly [AccentColor, ...AccentColor[]] = [
  { id: "red", label: "Red", value: "#c04e3e", hover: "#b91c1c" },
  { id: "orange", label: "Orange", value: "#d97706", hover: "#b45309" },
  { id: "green", label: "Green", value: "#2f855a", hover: "#276749" },
  { id: "blue", label: "Blue", value: "#2563eb", hover: "#1d4ed8" },
  { id: "purple", label: "Purple", value: "#7c3aed", hover: "#6d28d9" },
  { id: "graphite", label: "Graphite", value: "#4b5563", hover: "#374151" },
];

/** Editor font options. `stack` becomes the `--font-editor` CSS value. */
export interface EditorFont {
  id: string;
  label: string;
  stack: string;
}

export const EDITOR_FONTS: readonly [EditorFont, ...EditorFont[]] = [
  {
    id: "sans",
    label: "Sans (default)",
    stack:
      'Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    id: "serif",
    label: "Serif",
    stack: 'Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    id: "mono",
    label: "Monospace",
    stack:
      '"JetBrains Mono", "SF Mono", Consolas, "Fira Code", ui-monospace, monospace',
  },
  {
    id: "system",
    label: "System",
    stack:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
];

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 20;
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 2.0;

export interface Preferences {
  /** Accent color id, one of ACCENT_COLORS. */
  accent: string;
  /** Editor font id, one of EDITOR_FONTS. */
  editorFont: string;
  /** Editor base font size in px, clamped to [FONT_SIZE_MIN, FONT_SIZE_MAX]. */
  fontSize: number;
  /** Editor line height, clamped to [LINE_HEIGHT_MIN, LINE_HEIGHT_MAX]. */
  lineHeight: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  accent: "red",
  editorFont: "sans",
  fontSize: 16,
  lineHeight: 1.6,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function findAccent(id: string): AccentColor {
  return ACCENT_COLORS.find((a) => a.id === id) ?? ACCENT_COLORS[0];
}

export function findEditorFont(id: string): EditorFont {
  return EDITOR_FONTS.find((f) => f.id === id) ?? EDITOR_FONTS[0];
}

/**
 * Normalizes an arbitrary parsed value into a valid Preferences object.
 * Unknown ids fall back to defaults; out-of-range numbers are clamped.
 */
export function normalizePreferences(input: unknown): Preferences {
  const raw = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const accent =
    typeof raw.accent === "string" && ACCENT_COLORS.some((a) => a.id === raw.accent)
      ? raw.accent
      : DEFAULT_PREFERENCES.accent;
  const editorFont =
    typeof raw.editorFont === "string" &&
    EDITOR_FONTS.some((f) => f.id === raw.editorFont)
      ? raw.editorFont
      : DEFAULT_PREFERENCES.editorFont;
  const fontSize =
    typeof raw.fontSize === "number"
      ? Math.round(clamp(raw.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX))
      : DEFAULT_PREFERENCES.fontSize;
  const lineHeight =
    typeof raw.lineHeight === "number"
      ? clamp(
          Math.round(raw.lineHeight * 10) / 10,
          LINE_HEIGHT_MIN,
          LINE_HEIGHT_MAX,
        )
      : DEFAULT_PREFERENCES.lineHeight;
  return { accent, editorFont, fontSize, lineHeight };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    // Access to localStorage can throw in sandboxed contexts.
    return null;
  }
}

/**
 * Reads and normalizes preferences from localStorage. Any parse error or
 * corruption recovers to DEFAULT_PREFERENCES rather than throwing.
 */
export function loadPreferences(store: StorageLike | null = storage()): Preferences {
  if (!store) return { ...DEFAULT_PREFERENCES };
  try {
    const rawValue = store.getItem(PREFERENCES_STORAGE_KEY);
    if (!rawValue) return { ...DEFAULT_PREFERENCES };
    return normalizePreferences(JSON.parse(rawValue));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Persists normalized preferences. Failures are swallowed (quota, private mode). */
export function savePreferences(
  prefs: Preferences,
  store: StorageLike | null = storage(),
): Preferences {
  const normalized = normalizePreferences(prefs);
  try {
    store?.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore persistence failures; the in-memory value is still applied.
  }
  return normalized;
}

/**
 * Applies preferences to the document as CSS custom properties so the editor
 * and every Maek accent-using surface update immediately, without a reload.
 */
export function applyPreferences(
  prefs: Preferences,
  root: HTMLElement | null = typeof document !== "undefined"
    ? document.documentElement
    : null,
): void {
  if (!root) return;
  const accent = findAccent(prefs.accent);
  const font = findEditorFont(prefs.editorFont);
  root.style.setProperty("--color-maek-red", accent.value);
  root.style.setProperty("--color-maek-red-hover", accent.hover);
  root.dataset.accent = accent.id;
  root.style.setProperty("--font-editor", font.stack);
  root.style.setProperty("--font-editor-size", `${prefs.fontSize}px`);
  root.style.setProperty("--line-spacing-editor", String(prefs.lineHeight));
}

/* ============================ Theme resolution ============================ */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** Whether a stored/loaded theme string is a valid ThemePreference. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * Resolves a theme preference to a concrete theme. `system` follows the OS
 * setting; `prefersDark` is normally the result of a
 * `matchMedia("(prefers-color-scheme: dark)")` query.
 */
export function resolveTheme(
  theme: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

/** Reads the current OS dark-mode preference, defaulting to light. */
export function systemPrefersDark(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  } catch {
    return false;
  }
}
