import type { Config } from 'tailwindcss';

/**
 * Tailwind theme extension — every value MUST reference a CSS variable from
 * apps/web/app/globals.css (which carries the canonical design tokens).
 * The drift guard in scripts/check-token-drift.mjs asserts that every
 * `--<token>` declared in globals.css appears at least once below.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        'ink-base': 'var(--ink-base)',
        'ink-base-l': 'var(--ink-base-l)',
        'surface-01': 'var(--surface-01)',
        'surface-02': 'var(--surface-02)',
        'surface-03': 'var(--surface-03)',
        'surface-glass': 'var(--surface-glass)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',
        'border-hair': 'var(--border-hair)',
        'ink-primary': 'var(--text-primary)',
        'ink-secondary': 'var(--text-secondary)',
        'ink-muted': 'var(--text-muted)',
        'ink-faint': 'var(--text-faint)',
        accent: 'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'accent-deep': 'var(--accent-deep)',
        'accent-glow': 'var(--accent-glow)',
        'accent-wash': 'var(--accent-wash)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        info: 'var(--info)',
        neutral: 'var(--neutral)',
      },
      spacing: {
        's-1': 'var(--s-1)',
        's-2': 'var(--s-2)',
        's-3': 'var(--s-3)',
        's-4': 'var(--s-4)',
        's-5': 'var(--s-5)',
        's-6': 'var(--s-6)',
        's-7': 'var(--s-7)',
        's-8': 'var(--s-8)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        input: 'var(--r-input)',
        card: 'var(--r-card)',
        std: 'var(--r-std)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        lift: 'var(--shadow-lift)',
        glass: 'var(--shadow-glass)',
      },
      transitionTimingFunction: {
        ease: 'var(--ease)',
        'ease-spring': 'var(--ease-spring)',
      },
      transitionDuration: {
        fast: 'var(--t-fast)',
        std: 'var(--t-std)',
        slow: 'var(--t-slow)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        'fade-in-stagger': 'fade-in 240ms ease-out calc(var(--i) * 80ms) forwards',
      },
    },
  },
  plugins: [],
};

export default config;
