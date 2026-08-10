/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm off-white canvas, dark charcoal ink, restrained accents.
        canvas: '#FAF8F4',
        surface: '#FFFFFF',
        ink: {
          DEFAULT: '#26292E',
          soft: '#4A4F57',
          faint: '#6E747E',
        },
        line: '#E3DED4',
        teal: {
          50: '#EAF5F4',
          400: '#2A9187',
          600: '#0F766E',
          700: '#0B5A54',
        },
        bluish: {
          50: '#EDF2F8',
          500: '#4A6E96',
          700: '#375474',
        },
        coral: {
          50: '#FDEFEC',
          500: '#D9614C',
          700: '#A64430',
        },
        sunny: {
          50: '#FFF6E2',
          500: '#E0A32E',
          700: '#9C6F14',
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
