import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

// Texto em que cada caractere que muda rola na vertical com desfoque (o "rolo" da referência) —
// usado no relógio do ponto: a cada segundo só os dígitos que mudaram rolam. Algarismos tabulares
// pra largura não pular. Com movimento reduzido, troca o caractere direto.
const RollingText = ({ text, className = '', label }: { text: string; className?: string; label?: string }) => {
  const reduceMotion = useReducedMotion();
  return (
    <span className={`tabular inline-flex ${className}`}>
      <span className="sr-only">{label ?? text}</span>
      {text.split('').map((char, i) => (
        <span key={i} className="relative inline-flex overflow-hidden" aria-hidden="true">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={char}
              className="inline-block"
              initial={reduceMotion ? false : { y: '-70%', opacity: 0, filter: 'blur(4px)' }}
              animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
              exit={reduceMotion ? { opacity: 0 } : { y: '70%', opacity: 0, filter: 'blur(4px)' }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              {char}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
};

export default RollingText;
