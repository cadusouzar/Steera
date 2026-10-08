import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { Button, EmptyState, Field, Input, Notice, Panel, Select } from '../ui';
import {
  downloadStockCsv, formatMoney, formatQuantity, getPeriodSummary, listMovements, listPerformers, listProducts,
  MOVEMENT_REASON_LABELS, MOVEMENT_TYPE_LABELS,
  type MovementFilters, type MovementReason, type MovementType, type PeriodSummary, type Product, type StockMovement, type SummaryCategory,
} from '../../lib/stock';
import MovementsTable from './MovementsTable';

interface Props {
  refreshKey: number;
  canSeeCosts: boolean;
  canReverse: boolean;
  canExport: boolean;
  canMove: boolean;
  onNewMovement: () => void;
  onOpenMovement: (id: string) => void;
  onReverse: (movement: StockMovement) => void;
}

const PAGE_SIZE = 50;

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Início/fim do dia LOCAL (fuso do navegador), enviados como instantes.
const startOfDay = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString(); };
const endOfDay = (value: string) => { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString(); };

const CATEGORY_LABELS: Record<SummaryCategory, { title: string; hint?: string }> = {
  entries: { title: 'Entradas', hint: 'Saldo inicial e entradas' },
  exits: { title: 'Saídas', hint: 'Todas as saídas, inclusive perdas' },
  losses: { title: 'Perdas e avarias', hint: 'Já incluídas em saídas' },
  adjustmentsIn: { title: 'Ajustes positivos' },
  adjustmentsOut: { title: 'Ajustes negativos' },
};

const MovementsTab = ({ refreshKey, canSeeCosts, canReverse, canExport, canMove, onNewMovement, onOpenMovement, onReverse }: Props) => {
  const today = new Date();
  const [from, setFrom] = useState(toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(toDateInput(today));
  const [productId, setProductId] = useState('');
  const [type, setType] = useState<'' | MovementType>('');
  const [reason, setReason] = useState<'' | MovementReason>('');
  const [performer, setPerformer] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<StockMovement[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [performers, setPerformers] = useState<Array<{ userId: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    // Inclui excluídos/arquivados: o histórico deles continua consultável.
    listProducts({ view: 'all', pageSize: 200 }).then((r) => setProducts(r.items)).catch(() => undefined);
    listPerformers().then(setPerformers).catch(() => undefined);
  }, [refreshKey]);

  const periodValid = !!from && !!to && from <= to;
  const filters: MovementFilters = {
    productId: productId || undefined,
    type: type || undefined,
    reason: reason || undefined,
    performedByUserId: performer || undefined,
    from: periodValid ? startOfDay(from) : undefined,
    to: periodValid ? endOfDay(to) : undefined,
  };
  const key = JSON.stringify(filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const f = JSON.parse(key) as MovementFilters;
      const [list, sum] = await Promise.all([
        listMovements({ ...f, page, pageSize: PAGE_SIZE }),
        f.from && f.to ? getPeriodSummary(f.from, f.to) : Promise.resolve(null),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setSummary(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as movimentações.');
    } finally {
      setLoading(false);
    }
  }, [key, page]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadStockCsv('movements', filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  };

  const reset = (fn: () => void) => { fn(); setPage(1); };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reasonOptions = (Object.keys(MOVEMENT_REASON_LABELS) as MovementReason[]).filter((r) => r !== 'REVERSAL');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="De" htmlFor="mov-from">
            <Input id="mov-from" type="date" value={from} max={to} onChange={(e) => reset(() => setFrom(e.target.value))} />
          </Field>
          <Field label="Até" htmlFor="mov-to">
            <Input id="mov-to" type="date" value={to} min={from} onChange={(e) => reset(() => setTo(e.target.value))} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport && <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting}>Exportar CSV</Button>}
          {canMove && <Button icon={Plus} onClick={onNewMovement}>Nova movimentação</Button>}
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Select aria-label="Filtrar por produto" value={productId} onChange={(e) => reset(() => setProductId(e.target.value))} searchable>
          <option value="">Todos os produtos</option>
          {products.map((p) => <option key={p.id} value={p.id}>{`${p.name} · ${p.sku}${p.lifecycle === 'TRASHED' || p.lifecycle === 'ARCHIVED' ? ' (excluído)' : ''}`}</option>)}
        </Select>
        <Select aria-label="Filtrar por tipo" value={type} onChange={(e) => reset(() => setType(e.target.value as '' | MovementType))}>
          <option value="">Todos os tipos</option>
          {(Object.keys(MOVEMENT_TYPE_LABELS) as MovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</option>)}
        </Select>
        <Select aria-label="Filtrar por motivo" value={reason} onChange={(e) => reset(() => setReason(e.target.value as '' | MovementReason))}>
          <option value="">Todos os motivos</option>
          {reasonOptions.map((r) => <option key={r} value={r}>{MOVEMENT_REASON_LABELS[r]}</option>)}
        </Select>
        <Select aria-label="Filtrar por responsável" value={performer} onChange={(e) => reset(() => setPerformer(e.target.value))}>
          <option value="">Todos os responsáveis</option>
          {performers.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
        </Select>
      </div>

      {!periodValid && <Notice tone="warning" className="mb-4">O início do período precisa ser antes do fim.</Notice>}
      {error && (
        <Notice tone="danger" className="mb-4">
          {error} <button type="button" onClick={load} className="underline underline-offset-4 font-medium">Tentar de novo</button>
        </Notice>
      )}

      {summary && (
        <Panel title="Resumo do período" className="mb-4">
          <p className="text-[13px] text-muted mb-3">
            Considera todas as movimentações do período, inclusive de produtos excluídos (os filtros de produto, tipo, motivo e responsável
            valem só para a lista abaixo). Estornos aparecem separados e descontados no líquido.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
            {(Object.keys(CATEGORY_LABELS) as SummaryCategory[]).map((cat) => {
              const rows = summary.categories[cat];
              return (
                <div key={cat} className="rounded-md border border-border px-4 py-3">
                  <p className="text-[13px] font-medium text-foreground">{CATEGORY_LABELS[cat].title}</p>
                  {CATEGORY_LABELS[cat].hint && <p className="text-[12px] text-muted">{CATEGORY_LABELS[cat].hint}</p>}
                  {rows.length === 0 ? (
                    <p className="mt-2 text-[13px] text-muted">Nada no período</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {rows.map((r) => (
                        <li key={r.unit} className="text-[13px]">
                          <span className="block font-semibold text-foreground tabular">{formatQuantity(r.net.quantity, r.unit)} líquido</span>
                          <span className="block text-muted tabular">
                            {formatQuantity(r.original.quantity, r.unit)} registrado{r.reversed.count > 0 && ` · ${formatQuantity(r.reversed.quantity, r.unit)} estornado`}
                          </span>
                          {canSeeCosts && r.net.value !== undefined && <span className="block text-muted tabular">{formatMoney(r.net.value)} a custo</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5" role="status" aria-label="Carregando movimentações"><span className="skeleton block h-32 w-full" /></div>
        ) : items.length === 0 ? (
          <EmptyState title="Nenhuma movimentação" description="Nada encontrado com este período e estes filtros." />
        ) : (
          <MovementsTable items={items} showProduct canSeeCosts={canSeeCosts} canReverse={canReverse} onOpen={(m) => onOpenMovement(m.id)} onReverse={onReverse} />
        )}
      </div>
      {canReverse && items.length > 0 && (
        <p className="mt-3 text-[12px] text-muted">Estorno disponível só na última movimentação de cada produto (limitação desta versão).</p>
      )}
      {!loading && total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-[13px] text-muted">
          <span>{total} movimentações · página {page} de {pages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>Anterior</Button>
            <Button variant="secondary" size="sm" trailingIcon={ChevronRight} onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>Próxima</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MovementsTab;
