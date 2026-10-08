import { Prisma, ProductStatus } from '@prisma/client';

// Situação de estoque (Estoque v1). Só faz sentido para produto ATIVO fora da lixeira; inativo,
// na lixeira ou arquivado nunca entra em "baixo"/"esgotado". Um produto nunca é baixo e esgotado
// ao mesmo tempo: saldo zero é sempre "esgotado".
export type StockSituation = 'OUT_OF_STOCK' | 'LOW' | 'NO_MIN_ALERT' | 'NORMAL' | 'NOT_APPLICABLE';

export const STOCK_SITUATIONS: StockSituation[] = ['OUT_OF_STOCK', 'LOW', 'NO_MIN_ALERT', 'NORMAL', 'NOT_APPLICABLE'];

export function stockSituationOf(product: {
  status: ProductStatus;
  trashedAt: Date | null;
  archivedAt: Date | null;
  balance: Prisma.Decimal;
  minStock: Prisma.Decimal | null;
}): StockSituation {
  if (product.status !== ProductStatus.ACTIVE || product.trashedAt || product.archivedAt) return 'NOT_APPLICABLE';
  if (product.balance.isZero()) return 'OUT_OF_STOCK';
  if (product.minStock === null) return 'NO_MIN_ALERT';
  if (product.balance.lte(product.minStock)) return 'LOW';
  return 'NORMAL';
}
