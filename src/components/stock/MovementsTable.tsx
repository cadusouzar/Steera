import { RotateCcw } from 'lucide-react';
import { Button, StatusBadge, Table, TBody, TD, TH, THead, TR } from '../ui';
import {
  formatDateTime, formatMoney, formatQuantity, formatSignedQuantity, LIFECYCLE_LABELS, MOVEMENT_REASON_LABELS, MOVEMENT_TYPE_LABELS,
  type StockMovement,
} from '../../lib/stock';

interface Props {
  items: StockMovement[];
  showProduct?: boolean;
  /** Unidade fixa (histórico de um produto); na lista geral vem de cada movimentação. */
  unit?: string;
  /** Versão para a gaveta do produto: cabe na largura, sem a coluna de responsável (fica no detalhe). */
  compact?: boolean;
  canSeeCosts: boolean;
  canReverse: boolean;
  onOpen: (movement: StockMovement) => void;
  onReverse: (movement: StockMovement) => void;
}

const MovementsTable = ({ items, showProduct = false, unit, compact = false, canSeeCosts, canReverse, onOpen, onReverse }: Props) => (
  <Table minWidth={compact ? undefined : showProduct ? 860 : 640}>
    <THead>
      <tr>
        {!compact && <TH>Data</TH>}
        {showProduct && <TH>Produto</TH>}
        <TH>{compact ? 'Movimentação' : 'Tipo e motivo'}</TH>
        <TH align="right">Quantidade</TH>
        <TH align="right">Saldo</TH>
        {canSeeCosts && <TH align="right">Impacto no valor</TH>}
        {!compact && <TH>Responsável</TH>}
        <TH align="right"><span className="sr-only">Ações</span></TH>
      </tr>
    </THead>
    <TBody>
      {items.map((m) => {
        const u = unit ?? m.productUnit;
        const reversed = !!m.reversedById;
        return (
          <TR key={m.id} interactive onClick={() => onOpen(m)}>
            {!compact && <TD className="whitespace-nowrap text-[13px] text-muted">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen(m); }}
                className="text-left hover:underline underline-offset-4 outline-none focus-visible:underline"
                aria-label={`Ver detalhes da movimentação de ${formatDateTime(m.createdAt)}`}
              >
                {formatDateTime(m.createdAt)}
              </button>
            </TD>}
            {showProduct && (
              <TD>
                <span className="block font-medium text-foreground truncate max-w-[220px]">{m.productName}</span>
                <span className="block text-[12px] text-muted">
                  {m.productSku}
                  {m.productLifecycle && m.productLifecycle !== 'ACTIVE' && m.productLifecycle !== 'INACTIVE' && ` · ${LIFECYCLE_LABELS[m.productLifecycle]}`}
                </span>
              </TD>
            )}
            <TD>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {compact ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpen(m); }}
                    className="text-foreground text-left hover:underline underline-offset-4 outline-none focus-visible:underline"
                  >
                    {MOVEMENT_TYPE_LABELS[m.type]}
                  </button>
                ) : (
                  <span className="text-foreground">{MOVEMENT_TYPE_LABELS[m.type]}</span>
                )}
                {reversed && <StatusBadge tone="neutral">Estornada</StatusBadge>}
              </span>
              {compact && <span className="block text-[12px] text-muted">{formatDateTime(m.createdAt)}</span>}
              <span className="block text-[12px] text-muted">
                {m.type === 'REVERSAL' ? 'Estorno de movimentação anterior' : MOVEMENT_REASON_LABELS[m.reason]}
                {m.documentRef && ` · ${m.documentRef}`}
              </span>
            </TD>
            <TD align="right" className={`tabular whitespace-nowrap ${m.quantityDelta < 0 ? 'text-danger' : 'text-success'}`}>
              {formatSignedQuantity(m.quantityDelta, u)}
            </TD>
            <TD align="right" className="tabular whitespace-nowrap text-[13px]">
              <span className="text-muted">{formatQuantity(m.balanceBefore)} → </span>
              <span className="text-foreground">{formatQuantity(m.balanceAfter)}</span>
            </TD>
            {canSeeCosts && (
              <TD align="right" className="tabular whitespace-nowrap">
                {m.valueDelta === undefined ? '—' : `${m.valueDelta > 0 ? '+' : m.valueDelta < 0 ? '−' : ''}${formatMoney(Math.abs(m.valueDelta))}`}
              </TD>
            )}
            {!compact && <TD className="text-[13px] text-muted whitespace-nowrap max-w-[160px] truncate">{m.performedByName}</TD>}
            <TD align="right" className="w-10">
              {canReverse && m.reversible && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  onClick={(e) => { e.stopPropagation(); onReverse(m); }}
                  aria-label={`Estornar movimentação de ${formatDateTime(m.createdAt)}`}
                >
                  {compact ? null : 'Estornar'}
                </Button>
              )}
            </TD>
          </TR>
        );
      })}
    </TBody>
  </Table>
);

export default MovementsTable;
