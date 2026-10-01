import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import Button from './Button';
import { controlClass } from './fieldStyles';

// Janelas do kit (01/10/2026): Modal (centro), Drawer (lateral direita) e ConfirmDialog. Substituem
// as ~61 janelas feitas à mão. Sempre em portal no <body> (escapa de overflow/transform das páginas),
// Esc e clique no fundo fecham, o foco fica preso dentro e volta pra quem abriu, e a rolagem do
// fundo trava enquanto estiver aberta.

const EASE = [0.16, 1, 0.3, 1] as const;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;
// Pilha de janelas abertas: só a do topo reage a Esc e prende o foco (ex.: confirmação aberta por
// cima de um modal — Esc fecha só a confirmação).
const dialogStack: symbol[] = [];

function useDialogBehavior(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLElement>) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const token = Symbol('dialog');
    dialogStack.push(token);
    const isTop = () => dialogStack[dialogStack.length - 1] === token;
    openCount += 1;
    document.body.style.overflow = 'hidden';

    // Foco inicial: primeiro campo/controle do conteúdo (o botão de fechar fica por último na ordem).
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
      (preferred ?? panel).focus();
    }, 30);

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      dialogStack.splice(dialogStack.indexOf(token), 1);
      openCount -= 1;
      if (openCount === 0) document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open, panelRef]);
}

interface BaseProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Impede fechar por Esc/fundo (ex.: enquanto salva). */
  dismissable?: boolean;
}

const MODAL_WIDTH = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-4xl' } as const;

const CloseButton = ({ onClose }: { onClose: () => void }) => (
  <button
    type="button"
    onClick={onClose}
    className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-secondary outline-none focus-visible:ring-2 focus-visible:ring-foreground"
    aria-label="Fechar"
  >
    <X size={18} strokeWidth={1.6} />
  </button>
);

export const Modal = ({
  open, onClose, title, description, children, footer, size = 'md', dismissable = true,
}: BaseProps & { size?: keyof typeof MODAL_WIDTH }) => {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const close = () => { if (dismissable) onClose(); };
  useDialogBehavior(open, close, panelRef);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/40"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className={`relative w-full ${MODAL_WIDTH[size]} max-h-[92vh] flex flex-col bg-panel border border-border rounded-t-xl sm:rounded-lg shadow-2xl outline-none`}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98, filter: 'blur(6px)' }}
            transition={{ duration: 0.24, ease: EASE }}
          >
            <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-[17px] font-semibold text-foreground">{title}</h2>
                {description && <p id={descId} className="mt-1 text-[14px] text-muted">{description}</p>}
              </div>
              <CloseButton onClose={close} />
            </header>
            {children && <div className="px-6 pb-5 overflow-y-auto">{children}</div>}
            {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

const DRAWER_WIDTH = { md: 'max-w-md', lg: 'max-w-2xl' } as const;

export const Drawer = ({
  open, onClose, title, description, children, footer, size = 'md', dismissable = true,
}: BaseProps & { size?: keyof typeof DRAWER_WIDTH }) => {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const close = () => { if (dismissable) onClose(); };
  useDialogBehavior(open, close, panelRef);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120]">
          <motion.div
            className="absolute inset-0 bg-black/40"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            className={`absolute inset-y-0 right-0 w-full ${DRAWER_WIDTH[size]} flex flex-col bg-panel border-l border-border shadow-2xl outline-none`}
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-[17px] font-semibold text-foreground truncate">{title}</h2>
                {description && <p id={descId} className="mt-0.5 text-[14px] text-muted">{description}</p>}
              </div>
              <CloseButton onClose={close} />
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  /** Exige digitar este texto exato antes de confirmar (ações irreversíveis). */
  confirmText?: string;
  busy?: boolean;
  children?: ReactNode;
}

// "Tem certeza?" padrão. Com `confirmText`, o botão só libera depois de a pessoa digitar o texto.
export const ConfirmDialog = ({
  open, onClose, onConfirm, title, description, confirmLabel, cancelLabel = 'Cancelar', tone = 'default', confirmText, busy = false, children,
}: ConfirmDialogProps) => {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const blocked = confirmText !== undefined && typed.trim() !== confirmText;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} disabled={blocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {confirmText !== undefined && (
        <div className={children ? 'mt-4' : ''}>
          <label htmlFor={inputId} className="block text-[13px] text-muted mb-1.5">
            Para confirmar, digite <span className="font-medium text-foreground">{confirmText}</span>
          </label>
          <input id={inputId} value={typed} onChange={(e) => setTyped(e.target.value)} className={controlClass(false, 'h-10')} autoComplete="off" data-autofocus />
        </div>
      )}
    </Modal>
  );
};
