import { useId } from 'react';
import { LayoutGroup, motion } from 'framer-motion';

// Seletor de opções exclusivas (ex.: Todos / Ativos / Inativos). O fundo da opção escolhida desliza
// até ela — mesmo vocabulário de movimento das abas e da sidebar.
interface SegmentedControlProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

const SegmentedControl = <T extends string>({ options, value, onChange, label, className = '' }: SegmentedControlProps<T>) => {
  const groupId = useId();
  return (
    <LayoutGroup id={groupId}>
      <div role="radiogroup" aria-label={label} className={`inline-flex h-10 items-center gap-0.5 rounded-md border border-border bg-secondary p-0.5 ${className}`}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={`relative h-full px-3 rounded text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                active ? 'text-foreground font-medium' : 'text-muted hover:text-foreground'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="segment-bg"
                  className="absolute inset-0 rounded bg-panel shadow-sm ring-1 ring-border/70"
                  transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }}
                  aria-hidden="true"
                />
              )}
              <span className="relative">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
};

export default SegmentedControl;
