/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-aware RGB channels. The active values live in src/index.css.
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          soft: 'rgb(var(--color-ink-soft) / <alpha-value>)',
          faint: 'rgb(var(--color-ink-faint) / <alpha-value>)',
        },
        line: 'rgb(var(--color-line) / <alpha-value>)',
        teal: {
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
        },
        bluish: {
          50: 'rgb(var(--color-secondary-50) / <alpha-value>)',
          500: 'rgb(var(--color-secondary-500) / <alpha-value>)',
          700: 'rgb(var(--color-secondary-700) / <alpha-value>)',
        },
        coral: {
          50: 'rgb(var(--color-danger-50) / <alpha-value>)',
          500: 'rgb(var(--color-danger-500) / <alpha-value>)',
          700: 'rgb(var(--color-danger-700) / <alpha-value>)',
        },
        sunny: {
          50: 'rgb(var(--color-warm-50) / <alpha-value>)',
          500: 'rgb(var(--color-warm-500) / <alpha-value>)',
          700: 'rgb(var(--color-warm-700) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        card: '1rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(38, 41, 46, 0.06), 0 4px 12px rgba(38, 41, 46, 0.05)',
      },
      minHeight: {
        touch: '2.75rem',
      },
    },
  },
  plugins: [],
};
