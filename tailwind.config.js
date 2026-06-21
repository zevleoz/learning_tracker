/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          500: '#10b981',
          600: '#059669',
          700: '#047857'
        },
        sig: {
          hesitant: '#f59e0b',
          slow:     '#ef4444',
          growth:   '#10b981',
          stable:   '#64748b'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(2,6,23,.3), 0 1px 3px rgba(2,6,23,.15)',
        'card': '0 8px 24px rgba(2,6,23,.35)'
      },
      keyframes: {
        'fade-in': { '0%': { opacity: 0, transform: 'translateY(4px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'pulse-amber': { '0%, 100%': { boxShadow: '0 0 0 0 rgba(245,158,11,.5)' }, '50%': { boxShadow: '0 0 0 8px rgba(245,158,11,0)' } }
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'pulse-amber': 'pulse-amber 2s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
