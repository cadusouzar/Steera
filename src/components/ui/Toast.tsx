import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';

// Notificação de ação do kit (06/10/2026): pílula curta no canto inferior esquerdo confirmando o
// que a pessoa acabou de fazer ("Funcionário cadastrado: Marina Alves"). Só sucesso — erro continua
// no formulário. `toast.success()` pode ser chamado de qualquer lugar; `<Toaster />` fica montado
// uma vez na raiz (App.tsx). Texto sempre "ação + nome": o verbo concorda com a coisa, nunca com a
// pessoa (o sistema não sabe o gênero de ninguém).

interface ToastItem {
  id: number;
  message: string;
  /** Muda quando a mesma mensagem é disparada de novo: reinicia o tempo daquela pílula. */
  bump: number;
}

const DURATION_MS = 3500;
const MAX_VISIBLE = 3;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;

// eslint-disable-next-line react-refresh/only-export-components -- API imperativa do kit, chamada de qualquer lugar
export const toast = {
  success(message: string) {
    const existing = items.find((t) => t.message === message);
    if (existing) {
      // Mesma mensagem já visível: não duplica — vai para o fim (mais perto do canto) e reinicia o tempo.
      items = [...items.filter((t) => t !== existing), { ...existing, bump: existing.bump + 1 }];
    } else {
      items = [...items, { id: nextId++, message, bump: 0 }].slice(-MAX_VISIBLE);
    }
    emit();
  },
  dismiss(id: number) {
    items = items.filter((t) => t.id !== id);
    emit();
  },
};

const ToastPill = ({ item }: { item: ToastItem }) => {
  const reduceMotion = useReducedMotion();
  const remaining = useRef(DURATION_MS);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const hovered = useRef(false);
  const focused = useRef(false);
  const dismissed = useRef(false);

  const start = () => {
    if (dismissed.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => toast.dismiss(item.id), remaining.current);
  };
  const pause = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  };

  // Nova pílula ou mensagem repetida (bump): tempo cheio de novo.
  useEffect(() => {
    remaining.current = DURATION_MS;
    if (!hovered.current && !focused.current) start();
    else if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    // start/pause usam só refs; o efeito reinicia apenas quando a pílula é (re)disparada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.bump]);

  return (
    <motion.button
      type="button"
      layout={!reduceMotion}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
      onMouseEnter={() => { hovered.current = true; pause(); }}
      onMouseLeave={() => { hovered.current = false; if (!focused.current) start(); }}
      onFocus={() => { focused.current = true; pause(); }}
      onBlur={() => { focused.current = false; if (!hovered.current) start(); }}
      onClick={() => {
        dismissed.current = true;
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
        toast.dismiss(item.id);
      }}
      title="Fechar"
      className="pointer-events-auto flex max-w-[min(420px,100%)] items-center gap-2.5 rounded-lg bg-primary px-4 py-3 text-left text-[14px] font-medium text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
    >
      <Check size={16} strokeWidth={2.2} aria-hidden="true" className="shrink-0" />
      <span className="line-clamp-2">{item.message}</span>
    </motion.button>
  );
};

export const Toaster = () => {
  const list = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[400] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:left-5 sm:items-start"
    >
      <AnimatePresence initial={false}>
        {list.map((item) => <ToastPill key={item.id} item={item} />)}
      </AnimatePresence>
    </div>
  );
};
