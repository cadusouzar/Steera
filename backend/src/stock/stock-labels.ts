import { StockMovementReason, StockMovementType } from '@prisma/client';
import { ProductLifecycle } from './stock-presenter';
import { StockSituation } from './stock-situation.util';

// Rótulos em português usados nos CSVs (espelhados em src/lib/stockLabels.ts no frontend).
export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  INITIAL: 'Saldo inicial',
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  ADJUSTMENT: 'Ajuste por contagem',
  REVERSAL: 'Estorno',
};

export const MOVEMENT_REASON_LABELS: Record<StockMovementReason, string> = {
  INITIAL_BALANCE: 'Saldo inicial do cadastro',
  MANUAL_ENTRY: 'Entrada manual',
  PURCHASE_RECEIVED: 'Compra recebida (registro manual)',
  CUSTOMER_RETURN: 'Devolução de cliente',
  OTHER_ENTRY: 'Outra entrada',
  MANUAL_EXIT: 'Retirada manual',
  INTERNAL_CONSUMPTION: 'Consumo interno',
  LOSS: 'Perda',
  DAMAGE: 'Avaria',
  SUPPLIER_RETURN: 'Devolução ao fornecedor',
  OTHER_EXIT: 'Outra saída',
  COUNT_ADJUSTMENT: 'Ajuste por contagem',
  REVERSAL: 'Estorno',
};

export const SITUATION_LABELS: Record<StockSituation, string> = {
  OUT_OF_STOCK: 'Esgotado',
  LOW: 'Estoque baixo',
  NO_MIN_ALERT: 'Sem alerta de mínimo',
  NORMAL: 'Estoque normal',
  NOT_APPLICABLE: '—',
};

export const LIFECYCLE_LABELS: Record<ProductLifecycle, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  TRASHED: 'Na lixeira',
  ARCHIVED: 'Arquivado (excluído com histórico)',
};
