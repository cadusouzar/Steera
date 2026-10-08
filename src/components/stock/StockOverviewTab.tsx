import { useCallback, useEffect, useState } from 'react';
import { EmptyState, Notice, Panel, StatCard, StatValue, type LoadStatus } from '../ui';
import { formatMoney, formatQuantity, getStockOverview, listMovements, STOCK_UNITS, type StockMovement, type StockOverview } from '../../lib/stock';
import MovementsTable from './MovementsTable';

interface Props {
  refreshKey: number;
  canSeeCosts: boolean;
  canReverse: boolean;
  onGoTo: (tab: 'products' | 'movements' | 'replenishment', situation?: 'LOW' | 'OUT_OF_STOCK') => void;
  onOpenMovement: (id: string) => void;
  onReverse: (movement: StockMovement) => void;
}

const unitLabel = (code: string) => STOCK_UNITS.find((u) => u.code === code)?.label ?? code;

const StockOverviewTab = ({ refreshKey, canSeeCosts, canReverse, onGoTo, onOpenMovement, onReverse }: Props) => {
  const [overview, setOverview] = useState<StockOverview | null>(null);
  const [recent, setRecent] = useState<StockMovement[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const [o, m] = await Promise.all([getStockOverview(), listMovements({ page: 1, pageSize: 8 })]);
      setOverview(o);
      setRecent(m.items);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os indicadores.');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const errorText = <span className="text-[13px] text-muted">Indisponível</span>;
  const o = overview;

  return (
    <div>
      {error && (
        <Notice tone="danger" className="mb-4">
          {error} <button type="button" onClick={load} className="underline underline-offset-4 font-medium">Tentar de novo</button>
        </Notice>
      )}
      <div className={`grid grid-cols-2 ${canSeeCosts ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3 md:gap-4`}>
        {canSeeCosts && (
          <StatCard
            label="Valor do estoque (a custo)"
            status={status}
            error={errorText}
            value={<StatValue value={o?.totalValue ?? 0} format={formatMoney} compact />}
            footer={o && o.inactiveWithStock > 0 ? `Inclui ${o.inactiveWithStock} produto(s) inativo(s) com saldo` : 'Custo médio × saldo'}
          />
        )}
        <StatCard
          label="Produtos com saldo"
          status={status}
          error={errorText}
          value={<StatValue value={o?.skusWithStock ?? 0} />}
          footer={o ? `${o.activeProducts} produto(s) ativo(s)` : undefined}
        />
        <button type="button" onClick={() => onGoTo('products', 'LOW')} className="text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground">
          <StatCard label="Estoque baixo" status={status} error={errorText} value={<StatValue value={o?.lowStock ?? 0} />} footer="Ativos no mínimo ou abaixo" />
        </button>
        <button type="button" onClick={() => onGoTo('products', 'OUT_OF_STOCK')} className="text-left rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-foreground">
          <StatCard label="Esgotados" status={status} error={errorText} value={<StatValue value={o?.outOfStock ?? 0} />} footer="Ativos com saldo zero" />
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Panel title="Quantidade em estoque por unidade" className="lg:col-span-1">
          {status === 'loading' ? (
            <span className="skeleton block h-16 w-full" role="status" aria-label="Carregando" />
          ) : !o || o.quantityByUnit.length === 0 ? (
            <p className="text-[14px] text-muted">Nenhum produto com saldo.</p>
          ) : (
            <ul className="divide-y divide-border">
              {o.quantityByUnit.map((row) => (
                <li key={row.unit} className="flex items-center justify-between py-2 text-[14px]">
                  <span className="text-muted">{unitLabel(row.unit)} <span className="text-[12px]">({row.products} produto{row.products === 1 ? '' : 's'})</span></span>
                  <span className="font-medium text-foreground tabular">{formatQuantity(row.quantity, row.unit)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12px] text-muted">Unidades diferentes nunca são somadas entre si.</p>
        </Panel>

        <Panel
          title="Últimas movimentações"
          className="lg:col-span-2"
          padded={false}
          action={<button type="button" onClick={() => onGoTo('movements')} className="text-[13px] text-muted hover:text-foreground">Ver todas</button>}
        >
          <div className="pt-3">
            {status === 'loading' ? (
              <div className="px-5 pb-5"><span className="skeleton block h-24 w-full" role="status" aria-label="Carregando" /></div>
            ) : recent.length === 0 ? (
              <EmptyState title="Nenhuma movimentação ainda" description="Cadastre um produto com saldo inicial ou registre uma entrada." />
            ) : (
              <MovementsTable items={recent} showProduct canSeeCosts={canSeeCosts} canReverse={canReverse} onOpen={(m) => onOpenMovement(m.id)} onReverse={onReverse} />
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
};

export default StockOverviewTab;
