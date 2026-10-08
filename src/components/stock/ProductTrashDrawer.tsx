import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, ConfirmDialog, Drawer, EmptyState, Notice, toast } from '../ui';
import { formatDate, listTrashedProducts, restoreProduct, type TrashedProduct } from '../../lib/stock';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenProduct: (id: string) => void;
  onRestored: () => void;
}

// Lixeira de produtos (30 dias) — mesmo formato da lixeira de Clientes: botão "Lixeira" no topo da página
// abrindo esta gaveta (pedido do usuário, 08/10/2026; antes era uma aba). Ao abrir, o backend já processa o
// que venceu: sem movimentações → excluído de vez; com movimentações → arquivado (o histórico fica).
const ProductTrashDrawer = ({ open, onClose, onOpenProduct, onRestored }: Props) => {
  const [items, setItems] = useState<TrashedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [target, setTarget] = useState<TrashedProduct | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWarning(null);
    listTrashedProducts()
      .then((list) => { if (!cancelled) setItems(list); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível carregar a lixeira.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const restore = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await restoreProduct(target.id);
      toast.success(`Produto restaurado: ${restored.name}`);
      setItems((prev) => prev.filter((p) => p.id !== target.id));
      setWarning(
        restored.missingRequiredCustomFields.length > 0
          ? `${restored.name} foi restaurado, mas tem campos obrigatórios sem valor: ${restored.missingRequiredCustomFields.map((f) => f.displayName).join(', ')}.`
          : null,
      );
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível restaurar o produto.');
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Lixeira de produtos"
      description="Produtos excluídos ficam aqui por 30 dias e podem ser restaurados."
    >
      {warning && <Notice tone="warning" className="mb-4" onDismiss={() => setWarning(null)}>{warning}</Notice>}
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

      {loading ? (
        <div className="space-y-2" role="status" aria-label="Carregando lixeira">
          {[0, 1, 2].map((i) => <span key={i} className="skeleton block h-14" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Lixeira vazia" description="Ao excluir um produto sem saldo, ele aparece aqui por 30 dias." />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <button
                type="button"
                onClick={() => onOpenProduct(p.id)}
                className="min-w-0 text-left outline-none group"
              >
                <p className="text-[14px] font-medium text-foreground truncate group-hover:underline group-focus-visible:underline underline-offset-4">{p.name}</p>
                <p className="text-[12px] text-muted truncate">
                  {p.sku} · excluído em {p.trashedAt ? formatDate(p.trashedAt) : '—'}{p.trashedByName ? ` por ${p.trashedByName}` : ''}
                </p>
                <p className={`text-[13px] ${p.daysLeft <= 3 ? 'text-danger' : 'text-muted'}`}>
                  {p.daysLeft > 0 ? `${p.daysLeft} dia${p.daysLeft === 1 ? '' : 's'} para restaurar` : 'Último dia para restaurar'}
                  {' · '}
                  {p.afterTrashOutcome === 'DELETE' ? 'depois, excluído de vez' : 'depois, arquivado com o histórico'}
                </p>
              </button>
              <Button variant="secondary" size="sm" icon={RotateCcw} onClick={() => setTarget(p)} disabled={busy}>
                Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[12px] text-muted">
        Depois de 30 dias, produtos sem movimentações são excluídos definitivamente; os que têm movimentações são arquivados para
        preservar o histórico (continuam em “Exibir produtos excluídos” e nos relatórios).
      </p>

      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        onConfirm={restore}
        busy={busy}
        title={target ? `Restaurar ${target.name}?` : ''}
        description="O produto volta com o mesmo status, foto, campos e histórico de antes. Nenhuma movimentação é gerada."
        confirmLabel="Restaurar"
      />
    </Drawer>
  );
};

export default ProductTrashDrawer;
