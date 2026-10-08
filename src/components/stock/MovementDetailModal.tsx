import { useEffect, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Modal, Notice, StatusBadge } from '../ui';
import {
  formatCost, formatDateTime, formatMoney, formatQuantity, formatSignedQuantity, getMovement, LIFECYCLE_LABELS,
  MOVEMENT_REASON_LABELS, MOVEMENT_TYPE_LABELS, type StockMovement,
} from '../../lib/stock';

interface Props {
  movementId: string | null;
  canSeeCosts: boolean;
  canReverse: boolean;
  onClose: () => void;
  onOpenOther: (id: string) => void;
  onReverse: (movement: StockMovement) => void;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex justify-between gap-4 py-2 border-b border-border last:border-b-0 text-[14px]">
    <dt className="text-muted shrink-0">{label}</dt>
    <dd className="text-foreground text-right min-w-0 break-words">{children}</dd>
  </div>
);

const MovementDetailModal = ({ movementId, canSeeCosts, canReverse, onClose, onOpenOther, onReverse }: Props) => {
  const [movement, setMovement] = useState<StockMovement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!movementId) return;
    let cancelled = false;
    setMovement(null);
    setError(null);
    getMovement(movementId)
      .then((m) => { if (!cancelled) setMovement(m); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível carregar a movimentação.'); });
    return () => { cancelled = true; };
  }, [movementId]);

  const unit = movement?.productUnit ?? null;

  return (
    <Modal
      open={!!movementId}
      onClose={onClose}
      title={movement ? MOVEMENT_TYPE_LABELS[movement.type] : 'Movimentação'}
      description={movement ? `${movement.productName} · ${movement.productSku}` : undefined}
      footer={
        movement && canReverse && movement.reversible ? (
          <Button variant="secondary" icon={RotateCcw} onClick={() => onReverse(movement)}>Estornar</Button>
        ) : undefined
      }
    >
      {error && <Notice tone="danger">{error}</Notice>}
      {!movement && !error && <div className="space-y-3" role="status" aria-label="Carregando"><span className="skeleton block h-4 w-full" /><span className="skeleton block h-4 w-2/3" /></div>}
      {movement && (
        <>
          {movement.reversedById && (
            <Notice tone="info" className="mb-3">
              Esta movimentação foi estornada.{' '}
              <button type="button" className="underline underline-offset-4 font-medium" onClick={() => onOpenOther(movement.reversedById!)}>Ver o estorno</button>
            </Notice>
          )}
          {movement.original && (
            <Notice tone="info" className="mb-3">
              Estorno de {MOVEMENT_TYPE_LABELS[movement.original.type].toLowerCase()} de {formatDateTime(movement.original.createdAt)}.{' '}
              <button type="button" className="underline underline-offset-4 font-medium" onClick={() => onOpenOther(movement.original!.id)}>Ver a original</button>
            </Notice>
          )}
          {movement.productLifecycle && movement.productLifecycle !== 'ACTIVE' && (
            <p className="mb-2"><StatusBadge tone="neutral">Produto {LIFECYCLE_LABELS[movement.productLifecycle].toLowerCase()}</StatusBadge></p>
          )}
          <dl>
            <Row label="Data e hora">{formatDateTime(movement.createdAt)}</Row>
            <Row label="Motivo">{movement.type === 'REVERSAL' ? 'Estorno' : MOVEMENT_REASON_LABELS[movement.reason]}</Row>
            <Row label="Quantidade">{formatSignedQuantity(movement.quantityDelta, unit)}</Row>
            <Row label="Saldo">{formatQuantity(movement.balanceBefore, unit)} → {formatQuantity(movement.balanceAfter, unit)}</Row>
            {canSeeCosts && movement.unitCost !== undefined && (
              <>
                <Row label="Custo unitário aplicado">{formatCost(movement.unitCost)}</Row>
                <Row label="Impacto no valor">{`${(movement.valueDelta ?? 0) < 0 ? '−' : '+'}${formatMoney(Math.abs(movement.valueDelta ?? 0))}`}</Row>
                <Row label="Valor do estoque">{formatMoney(movement.valueBefore ?? 0)} → {formatMoney(movement.valueAfter ?? 0)}</Row>
                <Row label="Custo médio">{formatCost(movement.averageCostBefore ?? 0)} → {formatCost(movement.averageCostAfter ?? 0)}</Row>
              </>
            )}
            <Row label="Responsável">{movement.performedByName}</Row>
            {movement.documentRef && <Row label="Referência">{movement.documentRef}</Row>}
            {movement.notes && <Row label={movement.type === 'ADJUSTMENT' || movement.type === 'REVERSAL' ? 'Justificativa' : 'Observação'}>{movement.notes}</Row>}
            {(movement.productNameAtTime !== movement.productName || movement.productSkuAtTime !== movement.productSku) && (
              <Row label="Produto na época">{`${movement.productNameAtTime} · ${movement.productSkuAtTime}`}</Row>
            )}
          </dl>
        </>
      )}
    </Modal>
  );
};

export default MovementDetailModal;
