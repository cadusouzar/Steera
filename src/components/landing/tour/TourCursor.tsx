import { AnimatePresence, motion } from 'framer-motion';

// Cursor falso do tour: seta que desliza entre os pontos do roteiro (transição CSS, mesma curva do
// esboço) e, no clique, "afunda" e solta uma onda. Posição em coordenadas da janela inteira — a
// ponta da seta fica em (x, y).

interface TourCursorProps {
  x: number;
  y: number;
  clicking: boolean;
}

const TourCursor = ({ x, y, clicking }: TourCursorProps) => (
  <div
    className="pointer-events-none absolute left-0 top-0 z-30"
    style={{
      transform: `translate(${x - 4}px, ${y - 3}px)`,
      transition: 'transform 750ms cubic-bezier(.45,.05,.25,1)',
    }}
  >
    <AnimatePresence>
      {clicking && (
        <motion.span
          key="ripple"
          className="absolute left-1 top-[3px] block h-11 w-11 rounded-full bg-foreground"
          initial={{ opacity: 0.35, scale: 0.3 }}
          animate={{ opacity: 0, scale: 1.6 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          style={{ x: '-50%', y: '-50%' }}
        />
      )}
    </AnimatePresence>
    <motion.svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      className="relative block drop-shadow-[0_2px_3px_rgba(0,0,0,0.3)]"
      animate={clicking ? { scale: [1, 0.82, 1] } : { scale: 1 }}
      transition={{ duration: 0.28, times: [0, 0.4, 1] }}
      style={{ transformOrigin: '4px 3px' }}
    >
      <path d="M4 2.5 19.5 11l-6.8 1.6L9.6 19z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </motion.svg>
  </div>
);

export default TourCursor;
