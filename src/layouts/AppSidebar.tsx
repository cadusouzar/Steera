import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, Lock, type LucideIcon } from 'lucide-react';
import RollingCount from '../components/motion/RollingCount';

// Modelo de dados da sidebar (01/10/2026): AppLayout decide QUAIS itens existem (módulo, plano,
// permissão — mesmas regras de antes) e este componente só desenha. Ter a lista como dado é o que
// permite o realce único deslizante: um só bloco elevado que viaja até o item sob o mouse e volta
// pro item ativo quando o mouse sai (framer-motion `layoutId`).

export interface NavBadge {
  count: number;
  label: string;
}

export interface NavLink {
  kind: 'link';
  key: string;
  to: string;
  label: string;
  icon?: LucideIcon;
  badge?: NavBadge | null;
}

export interface NavDisabled {
  kind: 'disabled';
  key: string;
  label: string;
  note: string;
}

export interface NavGroup {
  kind: 'group';
  key: string;
  label: string;
  icon: LucideIcon;
  children: Array<NavLink | NavDisabled>;
}

export interface NavLocked {
  kind: 'locked';
  key: string;
  label: string;
  icon: LucideIcon;
  planLabel: string;
  onClick: () => void;
}

export type NavEntry = NavLink | NavGroup | NavLocked;

export interface NavSection {
  key: string;
  entries: NavEntry[];
}

interface AppSidebarProps {
  sections: NavSection[];
  isActive: (to: string) => boolean;
  openGroups: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  /** Distingue a instância desktop da gaveta do celular (cada uma com seu próprio realce). */
  layoutId: string;
  brand: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;

const groupHasActive = (group: NavGroup, isActive: (to: string) => boolean) =>
  group.children.some((c) => c.kind === 'link' && isActive(c.to));

const Highlight = ({ layoutId }: { layoutId: string }) => (
  <motion.span
    layoutId={layoutId}
    className="absolute inset-0 rounded-md bg-elevated shadow-md ring-1 ring-border/60"
    transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }}
    aria-hidden="true"
  />
);

const AppSidebar = ({ sections, isActive, openGroups, onToggleGroup, layoutId, brand }: AppSidebarProps) => {
  const reduceMotion = useReducedMotion();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Item "ativo" pro realce em repouso: o link da rota atual; se ele estiver dentro de um grupo
  // fechado, o próprio grupo.
  let activeKey: string | null = null;
  for (const section of sections) {
    for (const entry of section.entries) {
      if (entry.kind === 'link' && isActive(entry.to)) activeKey = entry.key;
      if (entry.kind === 'group' && groupHasActive(entry, isActive)) {
        const child = entry.children.find((c) => c.kind === 'link' && isActive(c.to));
        activeKey = openGroups[entry.key] && child ? child.key : entry.key;
      }
    }
  }
  const highlightKey = hoveredKey ?? activeKey;
  const highlightId = `${layoutId}-highlight`;

  const rowBase =
    'relative w-full flex items-center gap-3 rounded-md px-3 text-[14px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-foreground';
  const rowTone = (active: boolean) => (active ? 'text-foreground font-medium' : 'text-muted hover:text-foreground');
  const hoverProps = (key: string) => ({
    onMouseEnter: () => setHoveredKey(key),
    onFocus: () => setHoveredKey(key),
    onBlur: () => setHoveredKey(null),
  });

  const renderLink = (item: NavLink, nested: boolean) => {
    const active = isActive(item.to);
    const Icon = item.icon;
    return (
      <Link
        key={item.key}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        className={`${rowBase} ${nested ? 'h-9 pl-10' : 'h-10'} ${rowTone(active)}`}
        {...hoverProps(item.key)}
      >
        {highlightKey === item.key && <Highlight layoutId={highlightId} />}
        {Icon && <Icon size={18} strokeWidth={1.6} className="relative shrink-0" aria-hidden="true" />}
        <span className="relative flex-1 truncate">{item.label}</span>
        {item.badge && item.badge.count > 0 && (
          <RollingCount value={item.badge.count} label={item.badge.label} className="relative" />
        )}
      </Link>
    );
  };

  const renderEntry = (entry: NavEntry) => {
    if (entry.kind === 'link') return renderLink(entry, false);

    if (entry.kind === 'locked') {
      const Icon = entry.icon;
      return (
        <button
          key={entry.key}
          type="button"
          onClick={entry.onClick}
          title={`Disponível no plano ${entry.planLabel} — clique para ver os planos`}
          className={`${rowBase} h-10 text-muted hover:text-foreground text-left`}
          {...hoverProps(entry.key)}
        >
          {highlightKey === entry.key && <Highlight layoutId={highlightId} />}
          <Icon size={18} strokeWidth={1.6} className="relative shrink-0" aria-hidden="true" />
          <span className="relative flex-1 truncate">{entry.label}</span>
          <span className="relative inline-flex items-center gap-1 text-[11px] font-medium text-muted">
            <Lock size={12} strokeWidth={1.8} aria-hidden="true" />
            {entry.planLabel}
          </span>
          <span className="sr-only">(bloqueado)</span>
        </button>
      );
    }

    const open = !!openGroups[entry.key];
    const Icon = entry.icon;
    const containsActive = groupHasActive(entry, isActive);
    const panelId = `${layoutId}-${entry.key}-items`;
    // Soma dos badges dos filhos aparece no grupo fechado (a pendência não some só porque o grupo
    // está recolhido).
    const hiddenBadge = entry.children.reduce(
      (sum, c) => sum + (c.kind === 'link' && c.badge ? c.badge.count : 0),
      0,
    );
    return (
      <div key={entry.key}>
        <button
          type="button"
          onClick={() => onToggleGroup(entry.key)}
          aria-expanded={open}
          aria-controls={panelId}
          className={`${rowBase} h-10 text-left ${rowTone(containsActive)}`}
          {...hoverProps(entry.key)}
        >
          {highlightKey === entry.key && <Highlight layoutId={highlightId} />}
          <Icon size={18} strokeWidth={1.6} className="relative shrink-0" aria-hidden="true" />
          <span className="relative flex-1 truncate">{entry.label}</span>
          {!open && hiddenBadge > 0 && (
            <RollingCount value={hiddenBadge} label={`${hiddenBadge} ${hiddenBadge === 1 ? 'pendência' : 'pendências'}`} className="relative" />
          )}
          <ChevronDown
            size={15}
            strokeWidth={1.8}
            className={`relative shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              key="items"
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: EASE }}
              className="overflow-hidden"
            >
              <motion.div
                className="pt-0.5 space-y-0.5"
                initial={reduceMotion ? false : 'hidden'}
                animate="shown"
                variants={{ shown: { transition: { staggerChildren: 0.03 } } }}
              >
                {entry.children.map((child) => (
                  <motion.div
                    key={child.key}
                    variants={{
                      hidden: { opacity: 0, y: -4, filter: 'blur(2px)' },
                      shown: { opacity: 1, y: 0, filter: 'blur(0px)' },
                    }}
                    transition={{ duration: 0.2, ease: EASE }}
                  >
                    {child.kind === 'link' ? (
                      renderLink(child, true)
                    ) : (
                      <div className={`${rowBase} h-9 pl-10 text-muted/70 cursor-default`} aria-disabled="true">
                        <span className="flex-1 truncate">{child.label}</span>
                        <span className="text-[11px]">{child.note}</span>
                      </div>
                    )}
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="h-14 flex items-center px-6 shrink-0">
        <Link to="/app" className="text-[15px] font-bold tracking-[0.08em] uppercase text-foreground">
          {brand}
        </Link>
      </div>
      <LayoutGroup id={layoutId}>
        <nav
          className="flex-1 overflow-y-auto px-3 pb-6 pt-2"
          aria-label="Menu principal"
          onMouseLeave={() => setHoveredKey(null)}
        >
          {sections
            .filter((s) => s.entries.length > 0)
            .map((section, index) => (
              <div key={section.key} className={index > 0 ? 'mt-3 pt-3 border-t border-border' : ''}>
                <div className="space-y-0.5">{section.entries.map(renderEntry)}</div>
              </div>
            ))}
        </nav>
      </LayoutGroup>
    </div>
  );
};

export default AppSidebar;
