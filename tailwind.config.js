/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'],
        display: ['Tajawal', 'Cairo', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5d9e3',
          300: '#b0b8c9',
          400: '#8590a8',
          500: '#67738d',
          600: '#525c73',
          700: '#434b5d',
          800: '#3a404e',
          900: '#1f2330',
          950: '#13161f',
        },
        brand: {
          50: '#eef5ff',
          100: '#d9e8ff',
          200: '#bcd6ff',
          300: '#8ebcff',
          400: '#5897ff',
          500: '#3174ff',
          600: '#1a55f5',
          700: '#1442e1',
          800: '#1737b6',
          900: '#19338f',
          950: '#142157',
        },
        accent: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        gold: {
          400: '#f5c451',
          500: '#eab308',
          600: '#ca8a04',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        card: '0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.06)',
        pop: '0 8px 32px rgba(16,24,40,0.12)',
        glow: '0 0 0 1px rgba(49,116,255,0.18), 0 8px 28px rgba(49,116,255,0.18)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out both',
        'slide-in': 'slide-in 0.35s ease-out both',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
