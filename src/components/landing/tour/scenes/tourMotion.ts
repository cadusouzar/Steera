import { useReducedMotion } from 'framer-motion';

// Movimento comum às cenas do tour (07/10/2026): a curva das entradas e a entrada escalonada de blocos.

export const EASE = [0.16, 1, 0.3, 1] as const;

/** Entrada escalonada de um bloco (cards, painéis); some com movimento reduzido. */
export const useRise = () => {
  const reduceMotion = useReducedMotion();
  return (delay = 0) =>
    reduceMotion
      ? {}
      : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay, ease: EASE } };
};
