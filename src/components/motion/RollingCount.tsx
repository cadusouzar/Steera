import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface RollingCountProps {
  value: number;
  className?: string;
  /** Rótulo acessível, ex.: "3 pendências". */
  label: string;
}

// Badge redondo de contagem (preto no claro, branco no escuro). Quando o número muda, o antigo sai
// rolando pra cima e o novo entra de baixo, com desfoque — o efeito 5 → 10 → 1 da referência.
const RollingCount = ({ value, className = '', label }: RollingCountProps) => {
  const reduceMotion = useReducedMotion();
  const text = value > 99 ? '99+' : String(value);

  return (
    <span
      className={`relative inline-flex h-5 min-w-5 px-1.5 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground text-[11px] font-semibold tabular ${className}`}
      aria-label={label}
      role="status"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={reduceMotion ? false : { y: '110%', filter: 'blur(3px)', opacity: 0 }}
          animate={{ y: '0%', filter: 'blur(0px)', opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { y: '-110%', filter: 'blur(3px)', opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          aria-hidden="true"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

export default RollingCount;
