import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';

interface ThemeToggleProps {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

// Botão de ícone monocromático (01/10/2026) — antes era um interruptor ilustrado (céu, nuvens,
// estrelas) fora da paleta. O ícone troca rolando na vertical com desfoque, mesmo vocabulário de
// movimento dos números do painel.
const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, toggleTheme }) => {
  const isDark = theme === 'dark';
  const reduceMotion = useReducedMotion();
  const Icon = isDark ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="relative h-9 w-9 inline-flex items-center justify-center overflow-hidden rounded-lg border border-border bg-panel text-foreground hover:bg-secondary transition-colors"
      aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
      title={isDark ? 'Tema escuro' : 'Tema claro'}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={theme}
          className="inline-flex"
          initial={reduceMotion ? false : { y: 14, filter: 'blur(3px)', opacity: 0 }}
          animate={{ y: 0, filter: 'blur(0px)', opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: -14, filter: 'blur(3px)', opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
};

export default ThemeToggle;
