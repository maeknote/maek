/**
 * Design System - Effect Tokens
 *
 * Shadows, blur, border-radius, transitions, and animations.
 */

export const effects = {
  // Border radius
  radius: {
    none: '0',
    sm: '4px', // Small elements (icons, input fields)
    md: '6px', // Menu items, slash command items
    lg: '8px', // Larger menu items
    xl: '10px', // Bubble toolbar
    '2xl': '14px', // Primary context menus (liquid glass)
    '3xl': '20px', // Status badges
    full: '9999px' // Circular elements
  },

  // Box shadows
  shadow: {
    none: 'none',
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    floating: '0 4px 24px -4px rgba(0, 0, 0, 0.08)',
    // Glass panel shadow
    panel: `
      0 10px 36px -8px rgba(0, 0, 0, 0.12),
      0 5px 18px -4px rgba(0, 0, 0, 0.06)
    `.trim(),
    // Liquid glass menu shadow
    glass: `
      0 12px 40px rgba(0, 0, 0, 0.08),
      0 4px 16px rgba(0, 0, 0, 0.04),
      inset 0 1px 0 rgba(255, 255, 255, 0.85),
      inset 0 -1px 0 rgba(255, 255, 255, 0.15)
    `.trim(),
    // Inner glass shadow for depth
    glassInner: `
      inset 0 1.5px 0 rgba(255, 255, 255, 0.75),
      inset 0 -1.5px 2px rgba(0, 0, 0, 0.045),
      inset 1.5px 0 2px rgba(255, 255, 255, 0.45),
      inset -1.5px 0 2px rgba(0, 0, 0, 0.03)
    `.trim()
  },

  // Backdrop blur
  blur: {
    none: 'none',
    sm: 'blur(8px)',
    md: 'blur(16px)',
    lg: 'blur(24px)',
    xl: 'blur(28px)', // Primary liquid glass blur
    // Glass effect with saturation
    glass: 'blur(28px) saturate(2)'
  },

  // Liquid glass preset values
  glass: {
    background: 'rgba(245, 244, 241, 0.28)',
    border: 'rgba(242, 241, 238, 0.4)',
    backdropFilter: 'blur(28px) saturate(2)'
  },

  // Transitions
  transition: {
    none: 'none',
    fast: '120ms ease', // Button hover/active, quick feedback
    normal: '150ms ease', // Menu visibility, standard transitions
    slow: '300ms ease' // Logo effects, larger animations
  },

  // Animation keyframes (CSS string for use in stylesheets)
  animation: {
    menuFadeIn: {
      name: 'menu-fade-in',
      duration: '150ms',
      timing: 'ease-out',
      keyframes: `
        @keyframes menu-fade-in {
          from {
            opacity: 0;
            transform: translateY(-8px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `.trim()
    },
    cursorBlink: {
      name: 'cursor-blink',
      duration: '1s',
      timing: 'step-end',
      keyframes: `
        @keyframes cursor-blink {
          0%, 50% { opacity: 0.7; }
          51%, 100% { opacity: 0; }
        }
      `.trim()
    }
  },

  // Opacity levels
  opacity: {
    disabled: '0.5',
    muted: '0.6',
    subtle: '0.75',
    full: '1'
  }
} as const

// Type exports
export type Radius = keyof typeof effects.radius
export type Shadow = keyof typeof effects.shadow
export type Blur = keyof typeof effects.blur
export type Transition = keyof typeof effects.transition
