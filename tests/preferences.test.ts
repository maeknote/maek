import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  ACCENT_COLORS,
  EDITOR_FONTS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
  normalizePreferences,
  loadPreferences,
  savePreferences,
  applyPreferences,
  findAccent,
  findEditorFont,
  resolveTheme,
  isThemePreference,
  type Preferences,
} from "../client/src/lib/preferences";

/** Minimal in-memory Storage mock (localStorage stand-in for node tests). */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe("preferences: save and restore", () => {
  it("round-trips a full preferences object through storage", () => {
    const store = memoryStorage();
    const prefs: Preferences = {
      accent: "blue",
      editorFont: "serif",
      fontSize: 18,
      lineHeight: 1.8,
    };
    savePreferences(prefs, store);
    expect(loadPreferences(store)).toEqual(prefs);
    // The persisted payload is JSON under the documented key.
    expect(JSON.parse(store.getItem(PREFERENCES_STORAGE_KEY)!)).toEqual(prefs);
  });

  it("returns defaults when nothing is stored", () => {
    const store = memoryStorage();
    expect(loadPreferences(store)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("preferences: corrupted recovery", () => {
  it("recovers to defaults on unparseable JSON", () => {
    const store = memoryStorage();
    store.setItem(PREFERENCES_STORAGE_KEY, "{not json");
    expect(loadPreferences(store)).toEqual(DEFAULT_PREFERENCES);
  });

  it("recovers unknown accent / font ids to defaults", () => {
    const result = normalizePreferences({
      accent: "chartreuse",
      editorFont: "comic-sans",
      fontSize: 14,
      lineHeight: 1.5,
    });
    expect(result.accent).toBe(DEFAULT_PREFERENCES.accent);
    expect(result.editorFont).toBe(DEFAULT_PREFERENCES.editorFont);
    // Valid numeric fields are preserved even when other fields are invalid.
    expect(result.fontSize).toBe(14);
    expect(result.lineHeight).toBe(1.5);
  });

  it("recovers non-object payloads to full defaults", () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences(42)).toEqual(DEFAULT_PREFERENCES);
  });

  it("recovers non-numeric size / line-height to defaults", () => {
    const result = normalizePreferences({ fontSize: "big", lineHeight: null });
    expect(result.fontSize).toBe(DEFAULT_PREFERENCES.fontSize);
    expect(result.lineHeight).toBe(DEFAULT_PREFERENCES.lineHeight);
  });
});

describe("preferences: range clamping", () => {
  it("clamps font size below the minimum", () => {
    expect(normalizePreferences({ fontSize: 4 }).fontSize).toBe(FONT_SIZE_MIN);
  });
  it("clamps font size above the maximum", () => {
    expect(normalizePreferences({ fontSize: 99 }).fontSize).toBe(FONT_SIZE_MAX);
  });
  it("rounds font size to whole pixels", () => {
    expect(normalizePreferences({ fontSize: 15.6 }).fontSize).toBe(16);
  });
  it("clamps line height below the minimum", () => {
    expect(normalizePreferences({ lineHeight: 0.2 }).lineHeight).toBe(
      LINE_HEIGHT_MIN,
    );
  });
  it("clamps line height above the maximum", () => {
    expect(normalizePreferences({ lineHeight: 5 }).lineHeight).toBe(
      LINE_HEIGHT_MAX,
    );
  });
  it("handles non-finite numbers by clamping to the minimum", () => {
    expect(normalizePreferences({ fontSize: NaN }).fontSize).toBe(FONT_SIZE_MIN);
    expect(normalizePreferences({ lineHeight: Infinity }).lineHeight).toBe(
      LINE_HEIGHT_MIN,
    );
  });
});

describe("preferences: system theme resolution", () => {
  it("resolves explicit themes verbatim", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("resolves system to dark or light based on the OS setting", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("recognizes valid theme preference strings", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});

describe("preferences: apply to CSS variables", () => {
  it("writes accent, font, size and line-height custom properties", () => {
    const props = new Map<string, string>();
    const root = {
      style: {
        setProperty: (k: string, v: string) => void props.set(k, v),
      },
      dataset: {} as Record<string, string>,
    } as unknown as HTMLElement;

    const prefs: Preferences = {
      accent: "green",
      editorFont: "mono",
      fontSize: 13,
      lineHeight: 1.4,
    };
    applyPreferences(prefs, root);

    const accent = findAccent("green");
    const font = findEditorFont("mono");
    expect(props.get("--color-maek-red")).toBe(accent.value);
    expect(props.get("--color-maek-red-hover")).toBe(accent.hover);
    expect(props.get("--font-editor")).toBe(font.stack);
    expect(props.get("--font-editor-size")).toBe("13px");
    expect(props.get("--line-spacing-editor")).toBe("1.4");
    expect((root as HTMLElement).dataset.accent).toBe("green");
  });

  it("is a no-op when there is no root element", () => {
    expect(() => applyPreferences(DEFAULT_PREFERENCES, null)).not.toThrow();
  });
});

describe("preferences: catalog integrity", () => {
  it("exposes six accent colors with unique ids", () => {
    expect(ACCENT_COLORS).toHaveLength(6);
    expect(new Set(ACCENT_COLORS.map((a) => a.id)).size).toBe(6);
  });
  it("includes the default accent and font in the catalogs", () => {
    expect(findAccent(DEFAULT_PREFERENCES.accent).id).toBe(
      DEFAULT_PREFERENCES.accent,
    );
    expect(findEditorFont(DEFAULT_PREFERENCES.editorFont).id).toBe(
      DEFAULT_PREFERENCES.editorFont,
    );
    expect(EDITOR_FONTS.length).toBeGreaterThan(0);
  });
});
