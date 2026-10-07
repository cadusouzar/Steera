import type { CSSProperties, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { buttonClass, type ButtonSize, type ButtonVariant } from '../../../ui/buttonStyles';
import TourTyped from './TourTyped';
import { EASE } from './tourMotion';

// Peças desenhadas que as cenas do tour reaproveitam (07/10/2026): botão com as classes do kit,
// campo de formulário "digitado", chave, controle segmentado, fundo escuro de janela e as
// transições de entrada. Nada aqui é interativo: a janela do tour é só ilustração (aria-hidden).


/** Tela da cena: ocupa a área de conteúdo e entra/sai com um fade curto (usar dentro de AnimatePresence). */
export const Screen = ({ children }: { children: ReactNode }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="absolute inset-0"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {children}
    </motion.div>
  );
};

/** Fundo escurecido de uma janela (Modal) sobre a tela. */
export const Backdrop = () => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="absolute inset-0 bg-black/40"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    />
  );
};

/** Janela central (Modal do kit) em posição fixa na área de conteúdo. */
export const TourModal = ({ left, top, width, children }: { left: number; top: number; width: number; children: ReactNode }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="absolute rounded-lg border border-border bg-panel shadow-2xl"
      style={{ left, top, width }}
      initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

/** Gaveta lateral (Drawer do kit) presa à direita da área de conteúdo. */
export const TourDrawer = ({ width, children }: { width: number; children: ReactNode }) => {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className="absolute bottom-0 right-0 top-0 flex flex-col border-l border-border bg-panel shadow-2xl"
      style={{ width }}
      initial={reduceMotion ? false : { x: width }}
      animate={{ x: 0 }}
      exit={{ x: width }}
      transition={{ duration: 0.32, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

interface FakeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Botão ainda sem efeito (formulário incompleto): fica esmaecido, como o `disabled` do kit. */
  dim?: boolean;
}

export const FakeButton = ({ variant = 'primary', size = 'md', icon: Icon, children, className = '', style, dim }: FakeButtonProps) => (
  <span className={`${buttonClass(variant, size, className)} ${dim ? 'opacity-50' : ''}`} style={style}>
    {Icon && <Icon size={size === 'sm' ? 15 : 16} strokeWidth={1.8} />}
    {children}
  </span>
);

interface FakeFieldProps {
  label: string;
  required?: boolean;
  /** Valor digitado (ou já preenchido); vazio mostra o placeholder. */
  value?: string;
  placeholder?: string;
  /** Campo com foco: o valor aparece sendo digitado, com o cursor de texto. */
  focused?: boolean;
  select?: boolean;
  /** Área de texto (várias linhas, altura `rows`). */
  rows?: number;
  hint?: string;
  className?: string;
}

export const FakeField = ({ label, required, value, placeholder, focused, select, rows, hint, className = '' }: FakeFieldProps) => (
  <div className={className}>
    <p className="mb-1.5 text-[12.5px] font-medium text-foreground">
      {label}
      {required && <span className="text-danger"> *</span>}
    </p>
    <div
      className={`flex justify-between gap-2 rounded-md border bg-panel px-3 text-[13px] transition-[border-color,box-shadow] duration-200 ${
        rows ? 'items-start py-2 leading-snug' : 'h-9 items-center'
      } ${focused ? 'border-foreground/40 ring-2 ring-foreground/15' : 'border-border'}`}
      style={rows ? { height: rows * 18 + 16 } : undefined}
    >
      {value ? (
        <span className={`text-foreground ${rows ? 'whitespace-normal' : 'truncate'}`}>
          {focused && !select ? <TourTyped text={value} caret wrap={!!rows} /> : value}
        </span>
      ) : (
        <span className="truncate text-muted/80">{placeholder}</span>
      )}
      {select && <ChevronDown size={14} strokeWidth={1.8} className="shrink-0 text-muted" />}
    </div>
    {hint && <p className="mt-1 text-[11.5px] text-muted">{hint}</p>}
  </div>
);

/** Chave liga/desliga (Switch do kit) com rótulo e descrição. */
export const FakeSwitch = ({ on, label, description }: { on: boolean; label: string; description: string }) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <p className="text-[13.5px] font-medium text-foreground">{label}</p>
      <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>
    </div>
    <span className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${on ? 'bg-primary' : 'bg-foreground/20'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-panel shadow-sm transition-transform duration-200 ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </span>
  </div>
);

/** Controle segmentado (SegmentedControl do kit), só desenho. */
export const FakeSegmented = ({ options, active, className = '' }: { options: string[]; active: number; className?: string }) => (
  <div className={`inline-flex h-[38px] items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5 text-[12.5px] ${className}`}>
    {options.map((o, i) => (
      <span
        key={o}
        className={`flex h-full items-center whitespace-nowrap rounded px-3 ${i === active ? 'bg-panel text-foreground shadow-sm ring-1 ring-border/70' : 'text-muted'}`}
      >
        {o}
      </span>
    ))}
  </div>
);

/** Abas com sublinhado (Tabs do kit) em posições fixas, para o cursor acertar cada uma. */
export interface FakeTab { label: string; icon: LucideIcon; left: number; width: number; count?: number }

export const FakeTabs = ({ tabs, active, className = '' }: { tabs: FakeTab[]; active: number; className?: string }) => (
  <div className={`relative h-11 border-b border-border ${className}`}>
    {tabs.map((tb, i) => {
      const Icon = tb.icon;
      const on = i === active;
      return (
        <span
          key={tb.label}
          className={`absolute top-0 flex h-11 items-center justify-center gap-2 text-[13px] transition-colors duration-200 ${on ? 'font-medium text-foreground' : 'text-muted'}`}
          style={{ left: tb.left, width: tb.width }}
        >
          <Icon size={15} strokeWidth={1.7} /> {tb.label}
          {tb.count !== undefined && tb.count > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-secondary px-1 text-[11px] font-medium text-foreground tabular-nums">
              {tb.count}
            </span>
          )}
        </span>
      );
    })}
    <span
      className="absolute bottom-0 h-[2px] rounded-full bg-foreground transition-[left,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ left: tabs[active].left + 8, width: tabs[active].width - 16 }}
    />
  </div>
);

/** Destaque de uma linha recém-criada/alterada: um fundo que some aos poucos. */
export const RowFlash = () => {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;
  return (
    <motion.span
      className="pointer-events-none absolute inset-0 bg-secondary"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 2, delay: 0.4 }}
    />
  );
};
