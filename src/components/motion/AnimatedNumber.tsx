import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
  /** Duração da contagem em segundos. */
  duration?: number;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('pt-BR');

// Número que conta até o valor (do zero na primeira vez, do valor anterior depois) com o desfoque de
// movimento da referência: começa borrado e entra em foco conforme a contagem desacelera. Algarismos
// tabulares pra largura não "tremer" durante a contagem. Com movimento reduzido, mostra o valor direto.
const AnimatedNumber = ({ value, format = defaultFormat, className = '', duration = 0.9 }: AnimatedNumberProps) => {
  const reduceMotion = useReducedMotion();
  const progress = useMotionValue(1);
  const blur = useTransform(progress, [0, 0.7, 1], ['blur(3px)', 'blur(0.6px)', 'blur(0px)']);
  const fromRef = useRef(0);
  const [display, setDisplay] = useState(() => format(reduceMotion ? value : 0));

  useEffect(() => {
    if (reduceMotion) {
      fromRef.current = value;
      setDisplay(format(value));
      return;
    }
    const from = fromRef.current;
    const controls = animate(0, 1, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (t) => {
        progress.set(t);
        setDisplay(format(from + (value - from) * t));
      },
      onComplete: () => {
        fromRef.current = value;
      },
    });
    return () => {
      controls.stop();
      fromRef.current = value;
    };
    // `format` é estável na prática (função de módulo); incluí-lo reiniciaria a contagem a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduceMotion, duration]);

  return (
    <motion.span className={`tabular inline-block ${className}`} style={{ filter: blur }}>
      {display}
    </motion.span>
  );
};

export default AnimatedNumber;
