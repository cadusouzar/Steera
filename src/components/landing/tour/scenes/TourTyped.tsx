import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTourPaused } from '../tourPause';

// Texto "digitado" nas cenas do tour: ao aparecer, revela as letras rapidamente com um cursor de
// texto. Com movimento reduzido, mostra o texto inteiro direto. Com o tour pausado, a digitação para
// onde está (sem voltar ao começo).

interface TourTypedProps {
  text: string;
  /** Mostra o cursor de texto piscando no fim (campo com foco). */
  caret?: boolean;
  /** Duração total da digitação em ms. */
  duration?: number;
  /** Deixa o texto quebrar linha (área de texto). */
  wrap?: boolean;
}

const TourTyped = ({ text, caret = false, duration = 340, wrap = false }: TourTypedProps) => {
  const reduceMotion = useReducedMotion();
  const paused = useTourPaused();
  const [count, setCount] = useState(reduceMotion ? text.length : 0);
  // Texto novo recomeça a digitação (ajuste durante a renderização, não num efeito: assim pausar e
  // continuar não zeram o que já foi digitado).
  const [shownText, setShownText] = useState(text);
  if (shownText !== text) {
    setShownText(text);
    setCount(reduceMotion ? text.length : 0);
  }

  useEffect(() => {
    if (reduceMotion) {
      setCount(text.length);
      return;
    }
    if (paused) return;
    const stepMs = Math.max(12, Math.round(duration / Math.max(1, text.length)));
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c >= text.length) {
          window.clearInterval(id);
          return c;
        }
        return c + 1;
      });
    }, stepMs);
    return () => window.clearInterval(id);
  }, [text, duration, reduceMotion, paused]);

  return (
    <span className={wrap ? 'whitespace-normal' : 'whitespace-nowrap'}>
      {text.slice(0, count)}
      {caret && <span className="ml-px inline-block h-[1.05em] w-px translate-y-[0.15em] animate-pulse bg-foreground" />}
    </span>
  );
};

export default TourTyped;
