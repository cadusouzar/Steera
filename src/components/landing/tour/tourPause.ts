import { createContext, useContext } from 'react';

// Tour congelado (07/10/2026): o TourPlayer limpa os próprios timers ao pausar, mas algumas cenas
// têm relógio próprio (texto "digitado", relógio do Bater ponto). Elas leem este contexto e param o
// setInterval enquanto ele for `true` — sem desmontar nada, então a tela fica exatamente como estava.
export const TourPausedContext = createContext(false);

export const useTourPaused = () => useContext(TourPausedContext);
