/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./client/src/**/*.{js,ts,jsx,tsx}', './client/index.html'],
  theme: {
    extend: {
      colors: {
        // Shadcn/UI compatible colors (HSL variables)
        border: 'hsl(var(--border))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        primary: {
          DEFAULT: 'var(--color-maek-red)',
          foreground: '#FFFFFF'
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Design System Colors (from shared/design/css/variables.css)
        'paper-white': 'var(--color-paper-white)',
        'fog-grey': 'var(--color-fog-grey)',
        'warm-concrete': 'var(--color-warm-concrete)',
        'warm-vellum': 'var(--color-warm-vellum)',
        'warm-stone': 'var(--color-warm-stone)',
        'neutral-ink': 'var(--color-neutral-ink)',
        'muted-text': 'var(--color-muted-text)',
        'structure-line': 'var(--color-structure-line)',
        'maek-red': ({ opacityValue }) => opacityValue === undefined ? 'var(--color-maek-red)' : `color-mix(in srgb, var(--color-maek-red) calc(${opacityValue} * 100%), transparent)`,
        'text-main': 'var(--color-neutral-ink)',
        'border-gray': 'var(--color-border-light)',
        // Semantic colors for dark mode support
        surface: 'var(--color-paper-white)',
        'surface-overlay': 'var(--color-overlay-bg)',
        'surface-overlay-strong': 'var(--color-overlay-bg-strong)',
        'border-default': 'var(--color-structure-line)',
        'border-subtle': 'var(--color-border-subtle)',
        'input-bg': 'var(--color-input-bg)',
        'input-border': 'var(--color-input-border)'
      },
      boxShadow: {
        floating: 'var(--shadow-floating)',
        panel: 'var(--shadow-panel)',
        glass: 'var(--glass-shadow)'
      },
      borderRadius: {
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)'
      },
      fontFamily: {
        sans: ['Inter', 'Pretendard', 'sans-serif'],
        display: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      transitionDuration: {
        fast: '120ms',
        normal: '150ms'
      }
    }
  },
  plugins: []
}
