import { Prisma, Product, ProductBrand, ProductCategory, StockMovement } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { buildFileDownloadPath } from '../files/download-token.util';
import { stockSituationOf } from './stock-situation.util';

// Serialização do Estoque v1. Toda resposta passa por aqui — é o ÚNICO lugar que decide se custos
// saem da API. Sem `estoque.custos.ver`, custo de referência, custo médio, valor do estoque, custo
// aplicado e impacto no valor simplesmente não existem no JSON (nem como null).
export const COST_PERMISSION = 'estoque.custos.ver';

export function canSeeCosts(user: AuthenticatedUser): boolean {
  return COST_PERMISSION in (user.permissions ?? {});
}

const num = (v: Prisma.Decimal | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export type ProductLifecycle = 'ACTIVE' | 'INACTIVE' | 'TRASHED' | 'ARCHIVED';

export function lifecycleOf(p: Pick<Product, 'status' | 'trashedAt' | 'archivedAt'>): ProductLifecycle {
  if (p.archivedAt) return 'ARCHIVED';
  if (p.trashedAt) return 'TRASHED';
  return p.status;
}

export type ProductWithRelations = Product & {
  category?: ProductCategory | null;
  brand?: ProductBrand | null;
};

export function presentProduct(p: ProductWithRelations, showCosts: boolean, extra: Record<string, unknown> = {}) {
  const base = {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    description: p.description,
    photoUrl: p.photoAssetId ? buildFileDownloadPath(p.photoAssetId) : null,
    categoryId: p.categoryId,
    categoryName: p.category?.name ?? null,
    brandId: p.brandId,
    brandName: p.brand?.name ?? null,
    unit: p.unit,
    status: p.status,
    lifecycle: lifecycleOf(p),
    location: p.location,
    salePrice: num(p.salePrice),
    minStock: num(p.minStock),
    targetStock: num(p.targetStock),
    balance: Number(p.balance),
    situation: stockSituationOf(p),
    hasMovements: p.lastSequence > 0,
    trashedAt: p.trashedAt,
    trashedByName: p.trashedByName,
    archivedAt: p.archivedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
  const costs = showCosts
    ? { referenceCost: num(p.referenceCost), averageCost: Number(p.averageCost), stockValue: Number(p.stockValue) }
    : {};
  return { ...base, ...costs, ...extra };
}

export type MovementWithProduct = StockMovement & {
  product?: Pick<Product, 'id' | 'name' | 'sku' | 'unit' | 'status' | 'trashedAt' | 'archivedAt'> | null;
  reversedBy?: Pick<StockMovement, 'id'> | null;
};

export function presentMovement(m: MovementWithProduct, showCosts: boolean, extra: Record<string, unknown> = {}) {
  const base = {
    id: m.id,
    productId: m.productId,
    productName: m.product?.name ?? m.productNameAtTime,
    productSku: m.product?.sku ?? m.productSkuAtTime,
    productNameAtTime: m.productNameAtTime,
    productSkuAtTime: m.productSkuAtTime,
    productUnit: m.product?.unit ?? null,
    productLifecycle: m.product ? lifecycleOf(m.product) : null,
    sequence: m.sequence,
    type: m.type,
    reason: m.reason,
    quantity: Number(m.quantity),
    quantityDelta: Number(m.quantityDelta),
    balanceBefore: Number(m.balanceBefore),
    balanceAfter: Number(m.balanceAfter),
    notes: m.notes,
    documentRef: m.documentRef,
    performedByUserId: m.performedByUserId,
    performedByName: m.performedByName,
    reversalOfId: m.reversalOfId,
    reversedById: m.reversedBy?.id ?? null,
    origin: m.origin,
    createdAt: m.createdAt,
  };
  const costs = showCosts
    ? {
        unitCost: Number(m.unitCost),
        valueDelta: Number(m.valueDelta),
        valueBefore: Number(m.valueBefore),
        valueAfter: Number(m.valueAfter),
        averageCostBefore: Number(m.averageCostBefore),
        averageCostAfter: Number(m.averageCostAfter),
      }
    : {};
  return { ...base, ...costs, ...extra };
}
