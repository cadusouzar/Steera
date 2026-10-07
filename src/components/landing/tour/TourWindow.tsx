import type { ReactNode } from 'react';
import { ChevronDown, Sun } from 'lucide-react';
import SteeraLogo from '../../brand/SteeraLogo';
import { TOUR_H, TOUR_HEADER_H, TOUR_SIDEBAR_W, TOUR_W } from './tourTypes';
import { TOUR_MENU, TOUR_MENU_DIVIDER_Y, TOUR_MENU_ITEM_H, tourMenuTop } from './tourMenu';

// Moldura da "janela do sistema" do tour, no tamanho lógico TOUR_W × TOUR_H (o TourPlayer reduz
// com scale). Imita o AppLayout real: barra lateral (realce elevado no item ativo, que desliza),
// topo com tema e avatar desenhados, área de conteúdo onde entra a cena. Cursor e notificação ficam
// por cima de tudo, em coordenadas da janela inteira. É decorativa (aria-hidden no TourPlayer):
// nada aqui recebe foco; o clique no menu é só um atalho de mouse.

interface TourWindowProps {
  /** Item ativo do menu (índice em TOUR_MENU). */
  menu: number;
  /** Itens do menu que levam a uma cena (os outros não reagem ao clique). */
  clickable: ReadonlySet<number>;
  onMenu: (i: number) => void;
  children: ReactNode;
  cursor?: ReactNode;
  toast?: ReactNode;
}

const TourWindow = ({ menu, clickable, onMenu, children, cursor, toast }: TourWindowProps) => {
  const activeGroup = TOUR_MENU[menu]?.group;
  return (
    <div className="relative overflow-hidden bg-background font-sans text-foreground select-none" style={{ width: TOUR_W, height: TOUR_H }}>
      <div className="absolute left-0 top-0 bottom-0 border-r border-border bg-sidebar" style={{ width: TOUR_SIDEBAR_W }}>
        <div className="absolute left-5 top-[17px]">
          <SteeraLogo variant="mono" centerClassName="fill-sidebar" size="text-[22px]" />
        </div>

        {/* Realce elevado do item ativo — um bloco só, que desliza de um item para outro. */}
        <div
          className="absolute left-2.5 right-2.5 rounded-md bg-elevated shadow-md ring-1 ring-border/60 transition-[top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ top: tourMenuTop(menu), height: TOUR_MENU_ITEM_H }}
        />

        {TOUR_MENU.map((item, i) => {
          const Icon = item.icon;
          const active = i === menu || i === activeGroup;
          const canClick = clickable.has(i);
          return (
            <div
              key={item.label}
              onClick={canClick ? () => onMenu(i) : undefined}
              className={`absolute left-2.5 right-2.5 flex items-center gap-2.5 rounded-md text-[13px] transition-colors duration-300 ${
                item.sub ? 'pl-[38px] pr-3' : 'px-3'
              } ${active ? 'font-medium text-foreground' : 'text-muted'} ${canClick ? 'cursor-pointer hover:text-foreground' : ''}`}
              style={{ top: tourMenuTop(i), height: TOUR_MENU_ITEM_H }}
            >
              {Icon && <Icon size={16} strokeWidth={1.6} className="shrink-0" />}
              <span className="flex-1 truncate">{item.label}</span>
              {(i === 2 || i === 5) && <ChevronDown size={14} strokeWidth={1.8} className="shrink-0 rotate-180 text-muted" />}
            </div>
          );
        })}

        <div className="absolute left-3 right-3 h-px bg-border" style={{ top: TOUR_MENU_DIVIDER_Y }} />
      </div>

      <div
        className="absolute right-0 top-0 flex items-center justify-end gap-2 border-b border-border bg-panel px-5"
        style={{ left: TOUR_SIDEBAR_W, height: TOUR_HEADER_H }}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground">
          <Sun size={15} strokeWidth={1.7} />
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">R</span>
          <ChevronDown size={13} strokeWidth={1.8} className="text-muted" />
        </span>
      </div>

      <div className="absolute right-0 bottom-0 overflow-hidden" style={{ left: TOUR_SIDEBAR_W, top: TOUR_HEADER_H }}>
        {children}
      </div>

      {toast}
      {cursor}
    </div>
  );
};

export default TourWindow;
