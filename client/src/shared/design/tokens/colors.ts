/**
 * Design System - Color Tokens
 *
 * Central color definitions for the MAEK-NOTE application.
 * Use these tokens in TypeScript or reference the CSS variables in styles.
 */

export const colors = {
  // Paper - Background colors for different panels
  paper: {
    white: "#FFFFFF", // Editor (Center)
    fogGrey: "#F9F9F8", // Explorer (Left)
    warmConcrete: "#F2F2F0", // ChatPanel (Right)
    warmVellum: "#F8F7F2", // Alternative warm background
    warmStone: "#F2F1EE", // Alternative stone background
  },

  // Text colors
  text: {
    primary: "#171717", // Neutral ink - main text
    secondary: "#6B7280", // Muted text
    tertiary: "#9ca3af", // Placeholder, disabled text
    dark: "#2C2C2C", // Legacy dark text
  },

  // Accent colors
  accent: {
    red: "#C04E3E", // Maek red - primary accent
    redHover: "#b91c1c", // Darker red for hover states
    destructive: "#dc2626", // Destructive actions
  },

  // Border colors
  border: {
    default: "#E5E5E5", // Structure line - dividers
    light: "#E5E7EB", // Light border
    subtle: "rgba(0, 0, 0, 0.06)", // Subtle separator
  },

  // UI State colors
  state: {
    hover: "rgba(0, 0, 0, 0.06)",
    active: "rgba(0, 0, 0, 0.1)",
    selected: "rgba(59, 130, 246, 0.1)", // Blue tint for selected items
  },

  // Code block colors (VS Code Dark+ theme)
  code: {
    background: "#1e1e1e",
    text: "#d4d4d4",
    keyword: "#569cd6",
    string: "#ce9178",
    number: "#b5cea8",
    function: "#dcdcaa",
    comment: "#6a9955",
    builtin: "#4ec9b0",
  },

  // Legacy Electron Vite colors (for backward compatibility)
  legacy: {
    white: "#ffffff",
    whiteSoft: "#f8f8f8",
    whiteMute: "#f2f2f2",
    black: "#1b1b1f",
    blackSoft: "#222222",
    blackMute: "#282828",
    gray1: "#515c67",
    gray2: "#414853",
    gray3: "#32363f",
  },
} as const;

// Type exports for type-safe usage
export type ColorToken = typeof colors;
export type PaperColor = keyof typeof colors.paper;
export type TextColor = keyof typeof colors.text;
export type AccentColor = keyof typeof colors.accent;
