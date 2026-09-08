/**
 * Design System - Typography Tokens
 *
 * Font family, size, weight, and line height definitions.
 * Reference: FE/docs/DESIGN_GUIDE.md
 */

export const typography = {
  // Font families
  fontFamily: {
    // Interface (Menus, Sidebar, Buttons) + Editor Body
    sans: [
      'Inter',
      'Pretendard',
      '-apple-system',
      'BlinkMacSystemFont',
      'Segoe UI',
      'Roboto',
      'Oxygen',
      'Ubuntu',
      'Cantarell',
      'Fira Sans',
      'Droid Sans',
      'Helvetica Neue',
      'sans-serif'
    ],
    // Context & Data (Tags, File paths, Code)
    mono: [
      'JetBrains Mono',
      'SF Mono',
      'Consolas',
      'Fira Code',
      'ui-monospace',
      'SFMono-Regular',
      'Menlo',
      'Liberation Mono',
      'monospace'
    ]
  },

  // Font sizes
  fontSize: {
    xs: '0.6875rem', // 11px
    sm: '0.8125rem', // 13px
    base: '0.875rem', // 14px - default
    lg: '1rem', // 16px
    xl: '1.25rem', // 20px
    '2xl': '1.5rem', // 24px
    '3xl': '2rem' // 32px
  },

  // Font weights
  fontWeight: {
    normal: '400',
    medium: '450',
    semibold: '600',
    bold: '700'
  },

  // Line heights
  lineHeight: {
    none: '1',
    tight: '1.25',
    snug: '1.375',
    normal: '1.5',
    relaxed: '1.6', // Default for body text
    loose: '2'
  },

  // Heading styles (for editor)
  heading: {
    h1: {
      fontSize: '2rem',
      fontWeight: '700',
      marginTop: '1.5rem',
      marginBottom: '1rem'
    },
    h2: {
      fontSize: '1.5rem',
      fontWeight: '600',
      marginTop: '1.25rem',
      marginBottom: '0.75rem'
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: '600',
      marginTop: '1rem',
      marginBottom: '0.5rem'
    }
  }
} as const

// Type exports
export type FontFamily = keyof typeof typography.fontFamily
export type FontSize = keyof typeof typography.fontSize
export type FontWeight = keyof typeof typography.fontWeight
export type LineHeight = keyof typeof typography.lineHeight
