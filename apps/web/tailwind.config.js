/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#E8EFFB', 100: '#D3E0F6', 500: '#4F81BD', 600: '#3F6BA3', 700: '#2D4F80', 900: '#1C355B' },
      },
      fontFamily: { sans: ['Inter', 'Calibri', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
