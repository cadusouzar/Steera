import { StatusBadge, type StatusTone } from '../ui';
import { LIFECYCLE_LABELS, SITUATION_LABELS, type ProductLifecycle, type StockSituation } from '../../lib/stock';

const SITUATION_TONE: Record<StockSituation, StatusTone> = {
  OUT_OF_STOCK: 'danger',
  LOW: 'warning',
  NO_MIN_ALERT: 'neutral',
  NORMAL: 'success',
  NOT_APPLICABLE: 'neutral',
};

export const SituationBadge = ({ situation }: { situation: StockSituation }) =>
  situation === 'NOT_APPLICABLE' ? (
    <span className="text-[13px] text-muted">—</span>
  ) : (
    <StatusBadge tone={SITUATION_TONE[situation]}>{SITUATION_LABELS[situation]}</StatusBadge>
  );

// Só aparece quando o produto NÃO está ativo (ativo é o normal, não precisa de selo).
export const LifecycleBadge = ({ lifecycle }: { lifecycle: ProductLifecycle }) =>
  lifecycle === 'ACTIVE' ? null : (
    <StatusBadge tone={lifecycle === 'INACTIVE' ? 'neutral' : 'danger'}>{LIFECYCLE_LABELS[lifecycle]}</StatusBadge>
  );
