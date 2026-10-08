import { API_URL, apiRequest as request } from './api';
import { getAccessToken, refreshOnce } from './auth';

// Estoque v1 (08/10/2026) — cliente da API /stock/*. Campos de custo (custo de referência, custo
// médio, valor em estoque, custo aplicado, impacto no valor) só existem nas respostas quando o perfil
// tem `estoque.custos.ver`; por isso são opcionais aqui.

// ---- Unidades (espelho de backend/src/stock/stock-units.ts) ----
export interface StockUnit {
  code: string;
  label: string;
  fractional: boolean;
}

export const STOCK_UNITS: StockUnit[] = [
  { code: 'UN', label: 'Unidade', fractional: false },
  { code: 'PC', label: 'Peça', fractional: false },
  { code: 'CX', label: 'Caixa', fractional: false },
  { code: 'PAR', label: 'Par', fractional: false },
  { code: 'DZ', label: 'Dúzia', fractional: false },
  { code: 'KIT', label: 'Kit', fractional: false },
  { code: 'KG', label: 'Quilograma', fractional: true },
  { code: 'G', label: 'Grama', fractional: true },
  { code: 'L', label: 'Litro', fractional: true },
  { code: 'ML', label: 'Mililitro', fractional: true },
  { code: 'M', label: 'Metro', fractional: true },
  { code: 'CM', label: 'Centímetro', fractional: true },
  { code: 'M2', label: 'Metro quadrado', fractional: true },
  { code: 'M3', label: 'Metro cúbico', fractional: true },
];

export const isFractionalUnit = (code: string) => STOCK_UNITS.find((u) => u.code === code)?.fractional ?? false;

// ---- Tipos ----
export type ProductLifecycle = 'ACTIVE' | 'INACTIVE' | 'TRASHED' | 'ARCHIVED';
export type StockSituation = 'OUT_OF_STOCK' | 'LOW' | 'NO_MIN_ALERT' | 'NORMAL' | 'NOT_APPLICABLE';
export type MovementType = 'INITIAL' | 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'REVERSAL';
export type MovementReason =
  | 'INITIAL_BALANCE' | 'MANUAL_ENTRY' | 'PURCHASE_RECEIVED' | 'CUSTOMER_RETURN' | 'OTHER_ENTRY'
  | 'MANUAL_EXIT' | 'INTERNAL_CONSUMPTION' | 'LOSS' | 'DAMAGE' | 'SUPPLIER_RETURN' | 'OTHER_EXIT'
  | 'COUNT_ADJUSTMENT' | 'REVERSAL';

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  photoUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  unit: string;
  status: 'ACTIVE' | 'INACTIVE';
  lifecycle: ProductLifecycle;
  location: string | null;
  salePrice: number | null;
  minStock: number | null;
  targetStock: number | null;
  balance: number;
  situation: StockSituation;
  hasMovements: boolean;
  trashedAt: string | null;
  trashedByName: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  referenceCost?: number | null;
  averageCost?: number;
  stockValue?: number;
}

export interface ProductDetail extends Product {
  customFields: Record<string, unknown>;
  missingRequiredCustomFields: Array<{ columnName: string; displayName: string }>;
  reversibleMovementId: string | null;
  restoreDeadline: string | null;
  afterTrashOutcome: 'DELETE' | 'ARCHIVE' | null;
}

export interface TrashedProduct extends Product {
  restoreDeadline: string;
  daysLeft: number;
  afterTrashOutcome: 'DELETE' | 'ARCHIVE';
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  productNameAtTime: string;
  productSkuAtTime: string;
  productUnit: string | null;
  productLifecycle: ProductLifecycle | null;
  sequence: number;
  type: MovementType;
  reason: MovementReason;
  quantity: number;
  quantityDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  notes: string | null;
  documentRef: string | null;
  performedByUserId: string;
  performedByName: string;
  reversalOfId: string | null;
  reversedById: string | null;
  origin: string;
  createdAt: string;
  reversible?: boolean;
  original?: StockMovement | null;
  unitCost?: number;
  valueDelta?: number;
  valueBefore?: number;
  valueAfter?: number;
  averageCostBefore?: number;
  averageCostAfter?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TaxonomyItem {
  id: string;
  name: string;
  productCount: number;
}

export interface StockOverview {
  activeProducts: number;
  inactiveProducts: number;
  skusWithStock: number;
  inactiveWithStock: number;
  lowStock: number;
  outOfStock: number;
  inTrash: number;
  quantityByUnit: Array<{ unit: string; quantity: number; products: number }>;
  totalValue?: number;
}

export interface ReplenishmentItem extends Product {
  supplierName: string | null;
  quantityToTarget: number | null;
}

export interface SummaryPart {
  quantity: number;
  count: number;
  value?: number;
}

export type SummaryCategory = 'entries' | 'exits' | 'losses' | 'adjustmentsIn' | 'adjustmentsOut';

export interface PeriodSummary {
  period: { from: string; to: string };
  categories: Record<SummaryCategory, Array<{ unit: string; original: SummaryPart; reversed: SummaryPart; net: SummaryPart }>>;
}

export interface ProductFilters {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  categoryId?: string;
  brandId?: string;
  situation?: StockSituation;
  view?: 'current' | 'deleted' | 'all';
  selectable?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MovementFilters {
  productId?: string;
  from?: string;
  to?: string;
  type?: MovementType;
  reason?: MovementReason;
  performedByUserId?: string;
  page?: number;
  pageSize?: number;
}

export interface ProductInput {
  name?: string;
  sku?: string;
  barcode?: string | null;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  unit?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  location?: string | null;
  referenceCost?: string | null;
  salePrice?: string | null;
  minStock?: string | null;
  targetStock?: string | null;
  initialQuantity?: string | null;
  initialUnitCost?: string | null;
  customFields?: Record<string, unknown>;
}

function query(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

// ---- Produtos ----
export const listProducts = (filters: ProductFilters = {}) => request<Paged<Product>>(`/stock/products${query(filters)}`);
export const getProduct = (id: string) => request<ProductDetail>(`/stock/products/${id}`);
export const findProductByCode = (code: string) => request<Product>(`/stock/products/by-code/${encodeURIComponent(code)}`);
export const createProduct = (input: ProductInput) =>
  request<ProductDetail>('/stock/products', { method: 'POST', body: JSON.stringify(input) });
export const updateProduct = (id: string, input: ProductInput) =>
  request<ProductDetail>(`/stock/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const deactivateProduct = (id: string) => request<ProductDetail>(`/stock/products/${id}/deactivate`, { method: 'PATCH' });
export const reactivateProduct = (id: string) => request<ProductDetail>(`/stock/products/${id}/reactivate`, { method: 'PATCH' });
export const trashProduct = (id: string) => request<ProductDetail>(`/stock/products/${id}/trash`, { method: 'PATCH' });
export const restoreProduct = (id: string) => request<ProductDetail>(`/stock/products/${id}/restore`, { method: 'PATCH' });
export const listTrashedProducts = () => request<TrashedProduct[]>('/stock/products/trash');

export function uploadProductPhoto(id: string, file: File) {
  const form = new FormData();
  form.append('photo', file);
  return request<ProductDetail>(`/stock/products/${id}/photo`, { method: 'POST', body: form });
}
export const removeProductPhoto = (id: string) => request<ProductDetail>(`/stock/products/${id}/photo`, { method: 'DELETE' });

// ---- Movimentações ----
export const registerEntry = (productId: string, body: { requestId: string; quantity: string; unitCost: string; reason: MovementReason; notes?: string; documentRef?: string }) =>
  request<StockMovement>(`/stock/products/${productId}/entries`, { method: 'POST', body: JSON.stringify(body) });
export const registerExit = (productId: string, body: { requestId: string; quantity: string; reason: MovementReason; notes?: string; documentRef?: string }) =>
  request<StockMovement>(`/stock/products/${productId}/exits`, { method: 'POST', body: JSON.stringify(body) });
export const registerAdjustment = (
  productId: string,
  body: { requestId: string; countedQuantity: string; expectedBalance: string; unitCost?: string; notes: string; documentRef?: string },
) => request<StockMovement>(`/stock/products/${productId}/adjustments`, { method: 'POST', body: JSON.stringify(body) });
export const reverseMovement = (movementId: string, body: { requestId: string; notes: string }) =>
  request<StockMovement>(`/stock/movements/${movementId}/reverse`, { method: 'POST', body: JSON.stringify(body) });
export const listMovements = (filters: MovementFilters = {}) => request<Paged<StockMovement>>(`/stock/movements${query(filters)}`);
export const getMovement = (id: string) => request<StockMovement>(`/stock/movements/${id}`);
export const listPerformers = () => request<Array<{ userId: string; name: string }>>('/stock/movements/performers');

// ---- Categorias e marcas ----
export type TaxonomyKind = 'categories' | 'brands';
export const listTaxonomy = (kind: TaxonomyKind) => request<TaxonomyItem[]>(`/stock/${kind}`);
export const createTaxonomy = (kind: TaxonomyKind, name: string) =>
  request<TaxonomyItem>(`/stock/${kind}`, { method: 'POST', body: JSON.stringify({ name }) });
export const renameTaxonomy = (kind: TaxonomyKind, id: string, name: string) =>
  request<TaxonomyItem>(`/stock/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
export const deleteTaxonomy = (kind: TaxonomyKind, id: string) => request<void>(`/stock/${kind}/${id}`, { method: 'DELETE' });

// ---- Relatórios ----
export const getStockOverview = () => request<StockOverview>('/stock/reports/overview');
export const getReplenishment = () => request<ReplenishmentItem[]>('/stock/reports/replenishment');
export const getPeriodSummary = (from: string, to: string) =>
  request<PeriodSummary>(`/stock/reports/period-summary${query({ from, to })}`);

// Baixa um CSV autenticado (o navegador não manda o token num link comum) e dispara o download.
export async function downloadStockCsv(
  kind: 'position' | 'movements' | 'replenishment',
  params: object = {},
  isRetry = false,
): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_URL}/stock/reports/export/${kind}.csv${query(params)}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401 && !isRetry) {
    const renewed = await refreshOnce();
    if (renewed) return downloadStockCsv(kind, params, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { message?: string });
    throw new Error(body.message || 'Não foi possível gerar a planilha.');
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `estoque-${kind}.csv`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Rótulos (espelho de backend/src/stock/stock-labels.ts) ----
export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  INITIAL: 'Saldo inicial',
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  ADJUSTMENT: 'Ajuste por contagem',
  REVERSAL: 'Estorno',
};

export const MOVEMENT_REASON_LABELS: Record<MovementReason, string> = {
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

export const ENTRY_REASONS: MovementReason[] = ['MANUAL_ENTRY', 'PURCHASE_RECEIVED', 'CUSTOMER_RETURN', 'OTHER_ENTRY'];
export const EXIT_REASONS: MovementReason[] = ['MANUAL_EXIT', 'INTERNAL_CONSUMPTION', 'LOSS', 'DAMAGE', 'SUPPLIER_RETURN', 'OTHER_EXIT'];

export const SITUATION_LABELS: Record<StockSituation, string> = {
  OUT_OF_STOCK: 'Esgotado',
  LOW: 'Estoque baixo',
  NO_MIN_ALERT: 'Sem alerta de mínimo',
  NORMAL: 'Normal',
  NOT_APPLICABLE: '—',
};

export const LIFECYCLE_LABELS: Record<ProductLifecycle, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  TRASHED: 'Na lixeira',
  ARCHIVED: 'Arquivado',
};

// ---- Formatação ----
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatMoney = (value: number) => money.format(value);
export const formatCost = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
export const formatQuantity = (value: number, unit?: string | null) => {
  const text = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
  return unit ? `${text} ${unit}` : text;
};
export const formatSignedQuantity = (value: number, unit?: string | null) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatQuantity(Math.abs(value), unit)}`;
export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const formatDate = (iso: string) => new Intl.DateTimeFormat('pt-BR').format(new Date(iso));

// Converte o que a pessoa digitou ("1.234,5" ou "1234.5") para o formato que a API espera ("1234.5").
export function toApiNumber(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

// Valor de campo personalizado em texto, para a ficha do produto (só leitura).
export function formatCustomFieldValue(type: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  switch (type) {
    case 'BOOLEAN':
      return value ? 'Sim' : 'Não';
    case 'CURRENCY':
      return formatMoney(Number(value));
    case 'NUMBER':
      return new Intl.NumberFormat('pt-BR').format(Number(value));
    case 'DATE':
      return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(String(value)));
    case 'DATETIME':
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}
