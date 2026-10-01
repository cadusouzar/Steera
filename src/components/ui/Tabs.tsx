import { useId, useRef, type KeyboardEvent } from 'react';
import { LayoutGroup, motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

// Abas do kit (01/10/2026): o traço da aba ativa desliza até a aba escolhida (mesmo vocabulário do
// realce da sidebar). Teclado: setas esquerda/direita, Home/End — padrão WAI-ARIA de tablist.

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Rótulo acessível do grupo de abas. */
  label: string;
  className?: string;
}

const Tabs = <T extends string>({ tabs, value, onChange, label, className = '' }: TabsProps<T>) => {
  const groupId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };

  return (
    <LayoutGroup id={groupId}>
      <div role="tablist" aria-label={label} className={`flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border ${className}`}>
        {tabs.map((tab, index) => {
          const active = tab.id === value;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(el) => { refs.current[tab.id] = el; }}
              type="button"
              role="tab"
              id={`${groupId}-tab-${tab.id}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`relative inline-flex items-center gap-2 h-11 px-3 text-[14px] whitespace-nowrap transition-colors outline-none focus-visible:bg-secondary rounded-t-md ${
                active ? 'text-foreground font-medium' : 'text-muted hover:text-foreground'
              }`}
            >
              {Icon && <Icon size={16} strokeWidth={1.7} aria-hidden="true" />}
              {tab.label}
              {active && (
                <motion.span
                  layoutId="tab-indicator"
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-foreground"
                  transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
};

export default Tabs;
