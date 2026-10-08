import { useCallback, useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button, EmptyState, Notice, Table, TBody, TD, TH, THead, TR } from '../ui';
import { downloadStockCsv, formatQuantity, getReplenishment, type ReplenishmentItem } from '../../lib/stock';
import { SituationBadge } from './StockBadges';

interface Props {
  refreshKey: number;
  canExport: boolean;
  onOpen: (id: string) => void;
}

const ReplenishmentTab = ({ refreshKey, canExport, onOpen }: Props) => {
  const [items, setItems] = useState<ReplenishmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await getReplenishment());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a reposição.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadStockCsv('replenishment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gerar a planilha.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-[14px] text-muted max-w-2xl">
          Produtos ativos com estoque baixo ou esgotados. A quantidade para atingir o alvo é só alvo − saldo:
          nesta versão ela não considera pedidos de compra, reservas nem previsão de demanda.
        </p>
        {canExport && <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting}>Exportar CSV</Button>}
      </div>
      {error && (
        <Notice tone="danger" className="mb-4">
          {error} <button type="button" onClick={load} className="underline underline-offset-4 font-medium">Tentar de novo</button>
        </Notice>
      )}
      <div className="bg-panel border border-border rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5" role="status" aria-label="Carregando reposição"><span className="skeleton block h-24 w-full" /></div>
        ) : items.length === 0 ? (
          <EmptyState title="Nada para repor" description="Nenhum produto ativo está esgotado ou abaixo do mínimo." />
        ) : (
          <Table minWidth={720}>
            <THead>
              <tr>
                <TH>Produto</TH>
                <TH>Situação</TH>
                <TH align="right">Saldo</TH>
                <TH align="right">Mínimo</TH>
                <TH align="right">Alvo</TH>
                <TH align="right">Para atingir o alvo</TH>
                <TH>Fornecedor principal</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((p) => (
                <TR key={p.id} interactive onClick={() => onOpen(p.id)}>
                  <TD>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(p.id); }} className="font-medium text-foreground text-left hover:underline underline-offset-4 outline-none focus-visible:underline">
                      {p.name}
                    </button>
                    <span className="block text-[12px] text-muted">{p.sku}</span>
                  </TD>
                  <TD><SituationBadge situation={p.situation} /></TD>
                  <TD align="right" className="tabular whitespace-nowrap">{formatQuantity(p.balance, p.unit)}</TD>
                  <TD align="right" className="tabular whitespace-nowrap text-muted">{p.minStock === null ? '—' : formatQuantity(p.minStock, p.unit)}</TD>
                  <TD align="right" className="tabular whitespace-nowrap text-muted">{p.targetStock === null ? '—' : formatQuantity(p.targetStock, p.unit)}</TD>
                  <TD align="right" className="tabular whitespace-nowrap font-medium">{p.quantityToTarget === null ? '—' : formatQuantity(p.quantityToTarget, p.unit)}</TD>
                  <TD className="text-[13px] text-muted">{p.supplierName ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted">Fornecedor principal ficará disponível quando o ERP tiver o cadastro de fornecedores.</p>
    </div>
  );
};

export default ReplenishmentTab;
