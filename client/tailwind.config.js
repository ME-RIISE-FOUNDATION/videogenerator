/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.85)' },
          '70%': { transform: 'scale(1.03)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        'aurora-a': {
          '0%, 100%': { transform: 'translate(-12%, -8%) scale(1)' },
          '50%': { transform: 'translate(10%, 8%) scale(1.15)' },
        },
        'aurora-b': {
          '0%, 100%': { transform: 'translate(10%, 8%) scale(1.1)' },
          '50%': { transform: 'translate(-8%, -6%) scale(0.95)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 18px 0 rgba(99, 102, 241, 0.35)' },
          '50%': { boxShadow: '0 0 34px 4px rgba(139, 92, 246, 0.45)' },
        },
        'bounce-soft': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s ease-out both',
        'pop-in': 'pop-in 0.35s ease-out both',
        shimmer: 'shimmer 1.8s linear infinite',
        'aurora-a': 'aurora-a 26s ease-in-out infinite',
        'aurora-b': 'aurora-b 32s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2.8s ease-in-out infinite',
        'bounce-soft': 'bounce-soft 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
