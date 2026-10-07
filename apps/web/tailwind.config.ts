import type { Config } from 'tailwindcss';
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        primary: 'var(--primary)',
        accent: 'var(--accent)',
        star: 'var(--star)',
        text: 'var(--text)',
        muted: 'var(--text-muted)',
      },
    },
  },
  plugins: [],
} satisfies Config;
