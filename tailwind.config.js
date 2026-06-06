/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      colors: {
        ink: {
          950: '#070709',
          900: '#0b0b11',
          850: '#0f0f16',
          800: '#12121b',
          700: '#191924',
          600: '#22222f',
          500: '#2d2d3c',
          400: '#3a3a4d'
        },
        vibe: {
          DEFAULT: '#8b5cff',
          glow: '#a884ff'
        }
      },
      keyframes: {
        sweep: { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
        breathe: { '0%,100%': { opacity: '0.4' }, '50%': { opacity: '1' } },
        risein: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } }
      },
      animation: {
        sweep: 'sweep 2.4s linear infinite',
        breathe: 'breathe 1.8s ease-in-out infinite',
        risein: 'risein 0.25s ease-out both'
      }
    }
  },
  plugins: []
}
