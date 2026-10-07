import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';

// Notificação dentro da janela do tour: a mesma pílula do sistema (components/ui/Toast), no canto
// inferior esquerdo da janela, entrando e saindo como a real.

const TourToast = ({ message }: { message: string }) => (
  <div className="pointer-events-none absolute bottom-5 left-5 z-20">
    <AnimatePresence>
      {message && (
        <motion.div
          key={message}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
          className="flex max-w-[420px] items-center gap-2.5 rounded-lg bg-primary px-4 py-3 text-[14px] font-medium text-primary-foreground shadow-lg"
        >
          <Check size={16} strokeWidth={2.2} className="shrink-0" />
          <span className="whitespace-nowrap">{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

export default TourToast;
