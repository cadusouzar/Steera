/** @type {import('tailwindcss').Config} */

// Tokens em canais RGB ("20 20 20") + `<alpha-value>`: é o único formato em que o Tailwind 3 gera as
// variantes com opacidade (`bg-primary/10`, `border-border/50`...). Com `var(--x)` puro essas classes
// eram descartadas em silêncio (bug encontrado no redesign monocromático, 01/10/2026).
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        primary: {
          DEFAULT: token('primary'),
          foreground: token('primary-foreground'),
        },
        secondary: token('secondary'),
        accent: token('accent'),
        muted: token('muted'),
        border: token('border'),
        panel: token('panel'),
        sidebar: token('sidebar'),
        elevated: token('elevated'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        // Uma família só (Inter) no sistema inteiro — `font-heading` continua existindo pra não
        // tocar nas ~200 ocorrências, mas aponta pra mesma fonte.
        heading: ['Inter', 'sans-serif'],
      },
      // Visual monocromático: cantos quase retos. Remapear a escala (em vez de editar as ~190
      // ocorrências de rounded-xl/2xl/3xl) muda o sistema inteiro de uma vez.
      borderRadius: {
        sm: '3px',
        DEFAULT: '4px',
        md: '5px',
        lg: '6px',
        xl: '6px',
        '2xl': '8px',
        '3xl': '10px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        md: '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        lg: '0 12px 28px -6px rgb(0 0 0 / 0.12), 0 4px 8px -4px rgb(0 0 0 / 0.05)',
        xl: '0 20px 40px -12px rgb(0 0 0 / 0.18)',
        '2xl': '0 28px 60px -16px rgb(0 0 0 / 0.24)',
      },
    },
  },
  plugins: [],
}
