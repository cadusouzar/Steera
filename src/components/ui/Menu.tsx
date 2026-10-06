import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { buttonClass } from './buttonStyles';

// Menu de ações do kit (01/10/2026): botão que abre uma lista de ações por extenso (o usuário pediu
// texto em vez de só ícones, e um único botão por linha para a coluna não virar "pirâmide").
// Renderizado em portal com posição fixa (nunca é cortado pelo overflow de uma tabela). Teclado:
// setas/Home/End navegam, Enter/Espaço escolhem, Esc e Tab fecham, o foco volta ao botão.

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'danger';
  /** Linha divisória antes deste item. */
  separated?: boolean;
}

interface MenuProps {
  label: string;
  items: MenuItem[];
  /** Nome acessível do botão quando o rótulo visível é genérico (ex.: "Ações de joao@empresa.com"). */
  ariaLabel?: string;
  trigger?: ReactNode;
}

const Menu = ({ label, items, ariaLabel, trigger }: MenuProps) => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // Dentro de um modal o menu vai para o próprio diálogo (leitores de tela ignoram o que está fora de aria-modal).
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const itemButtons = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  useLayoutEffect(() => {
    if (open) itemButtons()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onMove = () => close(false);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);

  const toggle = () => {
    if (open) return close();
    setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    setPortalTarget(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body);
    setOpen(true);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const buttons = itemButtons();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => buttons[(i + buttons.length) % buttons.length]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(index + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(index - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(buttons.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    // Tab volta ao botão (o menu é portal: deixar o Tab seguir tiraria o foco do formulário/modal).
    else if (e.key === 'Tab') { e.preventDefault(); close(); }
  };

  // Abre para cima quando não cabe embaixo.
  const estimatedHeight = items.length * 40 + 16;
  const openUp = anchor ? anchor.bottom + 6 + estimatedHeight > window.innerHeight && anchor.top > estimatedHeight : false;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); toggle(); } }}
        className={buttonClass('secondary', 'sm', open ? 'bg-secondary' : '')}
      >
        {trigger ?? label}
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && anchor && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? label}
          onKeyDown={onMenuKeyDown}
          // Eventos de portal sobem pela árvore do React: sem isso, escolher um item dispararia
          // também o clique da linha da tabela onde o botão está.
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            right: Math.max(8, window.innerWidth - anchor.right),
            ...(openUp ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }),
          }}
          className="z-[150] min-w-[220px] max-w-[calc(100vw-16px)] rounded-md border border-border bg-elevated py-1.5 shadow-xl"
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={item.label}>
                {item.separated && i > 0 && <div className="my-1.5 border-t border-border" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={item.disabled}
                  onClick={() => { close(false); item.onSelect(); }}
                  className={`flex w-full items-center gap-2.5 px-3.5 h-9 text-left text-[14px] outline-none transition-colors disabled:opacity-50 focus-visible:bg-secondary hover:bg-secondary ${
                    item.tone === 'danger' ? 'text-danger' : 'text-foreground'
                  }`}
                >
                  {Icon && <Icon size={15} strokeWidth={1.8} className={item.tone === 'danger' ? '' : 'text-muted'} aria-hidden="true" />}
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>,
        portalTarget ?? document.body,
      )}
    </>
  );
};

export default Menu;
