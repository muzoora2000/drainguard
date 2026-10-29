export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        mist: '#f4f7f9',
        brand: {
          50: '#eefbf7',
          100: '#d5f5eb',
          200: '#acead9',
          300: '#76d8c2',
          400: '#40bda3',
          500: '#1f9f88',
          600: '#157f6e',
          700: '#14665a',
          800: '#145249',
          900: '#13443e'
        }
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.04)'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
