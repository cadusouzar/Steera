import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { EmptyState, Input, Modal, Notice, SegmentedControl } from '../ui';
import { formatQuantity, listProducts, type Product } from '../../lib/stock';
import type { MovementMode } from './MovementDialog';
import { LifecycleBadge } from './StockBadges';

interface Props {
  open: boolean;
  canMove: boolean;
  canAdjust: boolean;
  onClose: () => void;
  onPick: (mode: MovementMode, product: Product) => void;
}

// "Nova movimentação" fora da ficha: escolhe o tipo e o produto. Só aparecem produtos que podem ser
// movimentados (fora da lixeira e não arquivados) — inativos aparecem, para regularizar saldo.
const ProductPickerModal = ({ open, canMove, canAdjust, onClose, onPick }: Props) => {
  const modes = [
    ...(canMove ? [{ value: 'entry' as const, label: 'Entrada' }, { value: 'exit' as const, label: 'Saída' }] : []),
    ...(canAdjust ? [{ value: 'adjust' as const, label: 'Ajuste por contagem' }] : []),
  ];
  const [mode, setMode] = useState<MovementMode>(modes[0]?.value ?? 'entry');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setSearch(''); setError(null); } }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      listProducts({ selectable: true, search: search.trim() || undefined, pageSize: 30 })
        .then((r) => { if (!cancelled) setItems(r.items); })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível buscar produtos.'); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [open, search]);

  return (
    <Modal open={open} onClose={onClose} title="Nova movimentação" description="Escolha o tipo e o produto.">
      {modes.length > 1 && (
        <div className="mb-4 overflow-x-auto scrollbar-none">
          <SegmentedControl<MovementMode> label="Tipo de movimentação" value={mode} onChange={setMode} options={modes} />
        </div>
      )}
      <div className="relative mb-3">
        <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, SKU ou código de barras" aria-label="Buscar produto" className="pl-9" data-autofocus />
      </div>
      {error && <Notice tone="danger" className="mb-3">{error}</Notice>}
      {items.length === 0 ? (
        <EmptyState title="Nenhum produto encontrado" />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border max-h-[50vh] overflow-y-auto">
          {items.map((p) => {
            const disabled = mode === 'exit' && p.balance <= 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(mode, p)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-secondary/70 disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:bg-secondary"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{p.name}</span>
                      <LifecycleBadge lifecycle={p.lifecycle} />
                    </span>
                    <span className="block text-[12px] text-muted">{p.sku}</span>
                  </span>
                  <span className="text-[13px] text-muted tabular whitespace-nowrap">{disabled ? 'Sem saldo' : formatQuantity(p.balance, p.unit)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};

export default ProductPickerModal;
