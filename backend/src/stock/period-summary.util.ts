import { Prisma, StockMovementReason, StockMovementType } from '@prisma/client';

// Resumo por período do Estoque v1: entradas, saídas, perdas (subconjunto das saídas: perda e
// avaria) e ajustes positivos/negativos. Um estorno é contado na MESMA categoria da movimentação que
// ele estorna, separado em "estornos", e o "líquido" é original − estornos — nunca há dupla
// contagem, e o estorno nunca aparece como uma entrada ou saída comum. Um estorno feito dentro do
// período de algo registrado antes dele reduz o líquido do período (pode ficar negativo).
// Quantidades sempre separadas por unidade (nunca soma quilos com unidades).

export type SummaryCategory = 'entries' | 'exits' | 'losses' | 'adjustmentsIn' | 'adjustmentsOut';
export const SUMMARY_CATEGORIES: SummaryCategory[] = ['entries', 'exits', 'losses', 'adjustmentsIn', 'adjustmentsOut'];

export interface PeriodRow {
  type: StockMovementType;
  reason: StockMovementReason;
  origType: StockMovementType | null; // tipo da movimentação estornada (só para estornos)
  origReason: StockMovementReason | null;
  positive: boolean; // sentido da movimentação ORIGINAL (para estorno, o da estornada)
  unit: string;
  quantity: string; // soma das magnitudes
  value: string; // soma das magnitudes de impacto no valor
  count: number;
}

export interface SummaryPart {
  quantity: Prisma.Decimal;
  value: Prisma.Decimal;
  count: number;
}

export type PeriodSummary = Record<SummaryCategory, Record<string, { original: SummaryPart; reversed: SummaryPart; net: SummaryPart }>>;

const LOSS_REASONS: StockMovementReason[] = ['LOSS', 'DAMAGE'];

function categoriesOf(type: StockMovementType, reason: StockMovementReason, positive: boolean): SummaryCategory[] {
  switch (type) {
    case 'INITIAL':
    case 'ENTRY':
      return ['entries'];
    case 'EXIT':
      return LOSS_REASONS.includes(reason) ? ['exits', 'losses'] : ['exits'];
    case 'ADJUSTMENT':
      return [positive ? 'adjustmentsIn' : 'adjustmentsOut'];
    default:
      return [];
  }
}

const zero = (): SummaryPart => ({ quantity: new Prisma.Decimal(0), value: new Prisma.Decimal(0), count: 0 });

export function summarizePeriod(rows: PeriodRow[]): PeriodSummary {
  const summary = Object.fromEntries(SUMMARY_CATEGORIES.map((c) => [c, {}])) as PeriodSummary;
  for (const row of rows) {
    const isReversal = row.type === 'REVERSAL';
    const effType = isReversal ? row.origType : row.type;
    const effReason = isReversal ? row.origReason : row.reason;
    if (!effType || !effReason) continue;
    for (const category of categoriesOf(effType, effReason, row.positive)) {
      const bucket = (summary[category][row.unit] ??= { original: zero(), reversed: zero(), net: zero() });
      const part = isReversal ? bucket.reversed : bucket.original;
      part.quantity = part.quantity.add(row.quantity);
      part.value = part.value.add(row.value);
      part.count += row.count;
    }
  }
  for (const category of SUMMARY_CATEGORIES) {
    for (const bucket of Object.values(summary[category])) {
      bucket.net = {
        quantity: bucket.original.quantity.sub(bucket.reversed.quantity),
        value: bucket.original.value.sub(bucket.reversed.value),
        count: bucket.original.count - bucket.reversed.count,
      };
    }
  }
  return summary;
}
