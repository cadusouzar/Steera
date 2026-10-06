import {
  Children, Fragment, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Search } from 'lucide-react';
import { controlClass } from './fieldStyles';

// Dropdown do kit (06/10/2026): substitui o <select> nativo por uma lista desenhada e animada, igual
// em todo o sistema (inclusive no celular). Mesma API de antes — filhos <option>, `value` +
// `onChange(e)` com `e.target.value` —, então quem já usava o Select do kit não muda nada.
// Lista em portal com posição fixa (nunca cortada por tabela/modal), abre para cima quando não cabe,
// busca automática acima de 8 opções, teclado completo; Esc fecha só a lista, nunca o modal.

export interface SelectChangeEvent {
  target: { value: string; name?: string };
}

interface SelectProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: SelectChangeEvent) => void;
  children: ReactNode;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Classes extras do botão (somadas ao visual do kit, ou sozinhas com `unstyled`). */
  className?: string;
  /** Usa só `className` no botão — para telas com campos de estilo próprio (ex.: Cadastro). */
  unstyled?: boolean;
  placeholder?: string;
  /** Força ligar/desligar a busca; padrão: liga com mais de 8 opções. */
  searchable?: boolean;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  /** Repassado ao botão: o foco inicial de Modal/Drawer procura por `data-autofocus`. */
  'data-autofocus'?: boolean | string;
}

interface Option {
  value: string;
  label: string;
  disabled: boolean;
}

const SEARCH_THRESHOLD = 8;
const MAX_VISIBLE = 8;
const ITEM_HEIGHT = 40;
const SEARCH_HEIGHT = 52;
const GAP = 6;

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    if (child.type === Fragment) {
      out.push(...readOptions(props.children));
    } else if (child.type === 'option') {
      const label = textOf(props.children);
      out.push({ value: props.value === undefined ? label : String(props.value), label, disabled: !!props.disabled });
    }
  });
  return out;
}

const Select = ({
  id, name, value, defaultValue, onChange, children, required, disabled, invalid, className = '', unstyled = false,
  placeholder = 'Selecione…', searchable, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, 'aria-invalid': ariaInvalid, 'data-autofocus': dataAutofocus,
}: SelectProps) => {
  const options = useMemo(() => readOptions(children), [children]);
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value !== undefined ? value : inner;
  const selected = options.find((o) => o.value === current);

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const [labelInfo, setLabelInfo] = useState<{ name: string; labelId?: string }>({ name: '' });
  const [active, setActive] = useState(-1);
  const [nativeInvalid, setNativeInvalid] = useState(false);
  // Dentro de um modal a lista vai para o próprio diálogo (leitores de tela ignoram o que está fora de aria-modal).
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [popWidth, setPopWidth] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const reduceMotion = useReducedMotion();

  const uid = useId();
  const triggerId = id ?? `${uid}-trigger`;
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  const visible = useMemo(() => {
    const q = normalize(query.trim());
    if (!withSearch || !q) return options;
    return options.filter((o) => normalize(o.label).includes(q));
  }, [options, query, withSearch]);

  const firstEnabled = (list: Option[]) => list.findIndex((o) => !o.disabled);

  const choose = (next: string) => {
    if (value === undefined) setInner(next);
    if (next !== current) onChange?.({ target: { value: next, name } });
  };

  // A marca de inválido da validação nativa some sempre que o valor muda (escolha ou mudança pelo código).
  useEffect(() => {
    setNativeInvalid(false);
  }, [current]);

  // Aplica um texto de busca e põe a primeira opção que bate como ativa.
  const applyQuery = (next: string) => {
    setQuery(next);
    const q = normalize(next.trim());
    const matches = q ? options.filter((o) => normalize(o.label).includes(q)) : options;
    setActive(firstEnabled(matches));
  };

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openList = () => {
    if (disabled) return;
    setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    setPortalTarget(triggerRef.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body);
    setQuery('');
    const labelEl = document.querySelector<HTMLElement>(`label[for="${CSS.escape(triggerId)}"]`);
    setLabelInfo({ name: ariaLabel ?? labelEl?.textContent?.replace(/\s*\*\s*$/, '').trim() ?? '', labelId: labelEl?.id || undefined });
    const i = options.findIndex((o) => o.value === current && !o.disabled);
    setActive(i >= 0 ? i : firstEnabled(options));
    setOpen(true);
  };

  // Foco ao abrir: busca (se houver) ou a própria lista; sem rolar a página.
  useLayoutEffect(() => {
    if (!open) return;
    // Em tela de toque a busca não recebe foco (o teclado virtual taparia a lista); continua tocável.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    (withSearch && !coarse ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
  }, [open, withSearch]);

  // Largura real da lista (pode passar do campo): usada para nunca vazar pela borda direita.
  useLayoutEffect(() => {
    if (!open) return;
    const w = popRef.current?.offsetWidth ?? 0;
    if (w) setPopWidth((prev) => (prev === w ? prev : w));
  }, [open, anchor, visible]);

  // Mantém a opção ativa à vista.
  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
    // optionId é derivado de uid, estável.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  // Clique fora fecha; rolar a página ou redimensionar reposiciona.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // Rótulo do próprio campo: o clique dele já aciona o botão (que fecha a lista). Fechar aqui
      // faria o botão reabrir logo em seguida.
      if (target instanceof Element && target.closest(`label[for="${CSS.escape(triggerId)}"]`)) return;
      close(false);
      // Fundo de um modal: o primeiro clique só fecha a lista (como o select nativo); o modal fica.
      const dialog = triggerRef.current?.closest('[role="dialog"]');
      if (dialog && !dialog.contains(target)) {
        const swallow = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 600);
      }
      // Clique em área sem foco: devolve o foco ao campo (sem roubar de outro controle focável).
      window.setTimeout(() => {
        const a = document.activeElement;
        if (a === document.body || popRef.current?.contains(a)) triggerRef.current?.focus({ preventScroll: true });
      }, 0);
    };
    const reposition = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, close, triggerId]);

  const step = (dir: 1 | -1) => {
    setActive((a) => {
      let i = a;
      for (let n = 0; n < visible.length; n++) {
        i += dir;
        if (i < 0 || i >= visible.length) return a;
        if (!visible[i].disabled) return i;
      }
      return a;
    });
  };

  const edge = (toEnd: boolean) => {
    const list = toEnd ? [...visible].reverse() : visible;
    const i = firstEnabled(list);
    setActive(i < 0 ? -1 : toEnd ? visible.length - 1 - i : i);
  };

  // Digitar letras pula para a opção que começa com elas (como o select nativo).
  const typeaheadMatch = (key: string, list: Option[], from: number) => {
    const now = Date.now();
    const t = typeahead.current;
    t.text = now - t.at > 700 ? key : t.text + key;
    t.at = now;
    const q = normalize(t.text);
    const start = t.text.length === 1 ? from + 1 : Math.max(from, 0);
    for (let n = 0; n < list.length; n++) {
      const i = (start + n) % list.length;
      if (!list[i].disabled && normalize(list[i].label).startsWith(q)) return i;
    }
    return -1;
  };

  const isPrintable = (e: ReactKeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  const onTriggerKeyDown = (e: ReactKeyboardEvent) => {
    if (open) return;
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      openList();
    } else if (isPrintable(e)) {
      e.preventDefault();
      const i = typeaheadMatch(e.key, options, options.findIndex((o) => o.value === current));
      if (i >= 0) choose(options[i].value);
    }
  };

  const onListKeyDown = (e: ReactKeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); step(1); break;
      case 'ArrowUp': e.preventDefault(); step(-1); break;
      case 'Home':
      case 'End':
        // Na busca, Home/End movem o cursor do texto.
        if (e.target === searchRef.current) break;
        e.preventDefault();
        edge(e.key === 'End');
        break;
      case 'Enter': {
        e.preventDefault();
        const o = visible[active];
        if (o && !o.disabled) { choose(o.value); close(); }
        break;
      }
      case 'Escape':
        // Só a lista: o modal escuta Esc no documento, e o evento não pode chegar até ele.
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'Tab':
        // A lista vive num portal fora do formulário: Tab volta ao campo em vez de pular para o fim da página.
        e.preventDefault();
        close();
        break;
      default:
        if (!isPrintable(e)) break;
        if (!withSearch) {
          e.preventDefault();
          const i = typeaheadMatch(e.key, visible, active);
          if (i >= 0) setActive(i);
        } else if (e.target !== searchRef.current) {
          // Com o foco na lista (ex.: tela de toque com teclado físico), digitar vai para a busca.
          e.preventDefault();
          applyQuery(query + e.key);
          searchRef.current?.focus({ preventScroll: true });
        }
    }
  };

  // Posição: abaixo do campo, ou acima se não couber e houver mais espaço lá.
  let popStyle: CSSProperties = {};
  let openUp = false;
  let listMaxHeight = MAX_VISIBLE * ITEM_HEIGHT;
  if (anchor) {
    const wanted = Math.min(Math.max(visible.length, 1), MAX_VISIBLE) * ITEM_HEIGHT + (withSearch ? SEARCH_HEIGHT : 0) + 8;
    const below = window.innerHeight - anchor.bottom - GAP - 8;
    const above = anchor.top - GAP - 8;
    openUp = below < wanted && above > below;
    const room = (openUp ? above : below) - (withSearch ? SEARCH_HEIGHT : 0) - 8;
    listMaxHeight = Math.max(120, Math.min(MAX_VISIBLE * ITEM_HEIGHT, room));
    popStyle = {
      position: 'fixed',
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - 8 - Math.max(popWidth, anchor.width))),
      minWidth: anchor.width,
      ...(openUp ? { bottom: window.innerHeight - anchor.top + GAP } : { top: anchor.bottom + GAP }),
      transformOrigin: openUp ? 'bottom' : 'top',
    };
  }
  const offsetY = reduceMotion ? 0 : openUp ? 4 : -4;
  const startScale = reduceMotion ? 1 : 0.96;

  const isInvalid = !!invalid || nativeInvalid || ariaInvalid === true || ariaInvalid === 'true';
  const showsPlaceholder = !selected || selected.value === '';

  return (
    <>
      <div className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={isInvalid || undefined}
        aria-required={required || undefined}
        data-autofocus={dataAutofocus}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onTriggerKeyDown}
        className={`flex items-center justify-between gap-2 text-left ${
          unstyled ? className : controlClass(isInvalid, `h-10 ${className}`)
        }`}
      >
        <span className={`truncate ${showsPlaceholder ? 'text-muted' : ''}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Mantém o valor em formulários nativos (name/required) sem aparecer nem receber foco. */}
      {(name || required) && (
        <select
          aria-hidden="true"
          tabIndex={-1}
          name={name}
          required={required}
          disabled={disabled}
          value={current}
          onChange={() => undefined}
          // A validação nativa (required) foca este campo invisível: devolve o foco ao botão visível.
          onFocus={() => triggerRef.current?.focus()}
          // Marca o botão como inválido; sem preventDefault, o aviso nativo aparece ancorado sobre ele.
          onInvalid={() => setNativeInvalid(true)}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        >
          {options.map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
        </select>
      )}
      </div>

      {createPortal(
        <AnimatePresence>
          {open && anchor && (
            <motion.div
              ref={popRef}
              key="select-popover"
              initial={{ opacity: 0, scale: startScale, y: offsetY }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }}
              exit={{ opacity: 0, scale: startScale, y: offsetY, transition: { duration: 0.12, ease: 'easeIn' } }}
              style={popStyle}
              // Telas que acompanham o foco (ex.: dica do mascote no Cadastro) reconhecem a lista por aqui.
              data-select-popover=""
              onKeyDown={onListKeyDown}
              // Eventos de portal sobem pela árvore do React (ex.: linha clicável de tabela).
              onClick={(e) => e.stopPropagation()}
              className="z-[300] max-w-[calc(100vw-16px)] overflow-hidden rounded-md border border-border bg-elevated shadow-xl"
            >
              {withSearch && (
                <div className="border-b border-border p-2">
                  <div className="relative">
                    <Search size={15} strokeWidth={1.8} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      ref={searchRef}
                      type="text"
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={listId}
                      aria-autocomplete="list"
                      aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                      aria-label={labelInfo.name ? `Buscar em ${labelInfo.name}` : 'Buscar opção'}
                      placeholder="Buscar…"
                      autoComplete="off"
                      value={query}
                      onChange={(e) => applyQuery(e.target.value)}
                      className="h-9 w-full rounded bg-secondary pl-8 pr-2.5 text-[14px] text-foreground placeholder:text-muted outline-none focus:ring-2 focus:ring-foreground/15"
                    />
                  </div>
                </div>
              )}
              <div
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                aria-labelledby={labelInfo.labelId}
                aria-label={labelInfo.labelId ? undefined : labelInfo.name || undefined}
                aria-activedescendant={!withSearch && active >= 0 ? optionId(active) : undefined}
                style={{ maxHeight: listMaxHeight }}
                className="overflow-y-auto overscroll-contain py-1 outline-none"
              >
                {visible.length === 0 ? (
                  <p className="px-3 py-2.5 text-[14px] text-muted">Nenhuma opção encontrada</p>
                ) : (
                  visible.map((o, i) => {
                    const isSelected = o.value === current;
                    return (
                      <div
                        key={`${o.value}-${i}`}
                        id={optionId(i)}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={o.disabled || undefined}
                        onMouseMove={() => { if (!o.disabled && active !== i) setActive(i); }}
                        // Mantém o foco na busca/lista ao clicar.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { if (!o.disabled) { choose(o.value); close(); } }}
                        className={`mx-1 flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-2 text-[14px] [@media(pointer:coarse)]:min-h-11 ${
                          i === active ? 'bg-secondary' : ''
                        } ${o.disabled ? 'cursor-not-allowed opacity-50' : ''} ${
                          isSelected ? 'font-medium text-foreground' : o.value === '' ? 'text-muted' : 'text-foreground'
                        }`}
                      >
                        <span className="truncate">{o.label}</span>
                        {isSelected && <Check size={15} strokeWidth={2} aria-hidden="true" className="shrink-0" />}
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        portalTarget ?? document.body,
      )}
    </>
  );
};

export default Select;
