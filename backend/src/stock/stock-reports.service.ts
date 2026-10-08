import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementReason, StockMovementType } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CustomFieldValuesService } from '../custom-fields/custom-field-values.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { buildCsv, CsvCell, csvNumber, formatDateTime } from './csv.util';
import { QueryMovementsDto } from './dto/movement.dto';
import { QueryProductsDto } from './dto/product.dto';
import { PeriodRow, SUMMARY_CATEGORIES, summarizePeriod } from './period-summary.util';
import { ProductsService } from './products.service';
import { LIFECYCLE_LABELS, MOVEMENT_REASON_LABELS, MOVEMENT_TYPE_LABELS, SITUATION_LABELS } from './stock-labels';
import { StockMovementsService } from './stock-movements.service';
import { canSeeCosts } from './stock-presenter';

const CSV_MAX_ROWS = 50_000;
const MAX_PERIOD_DAYS = 366;

function customFieldText(value: unknown): CsvCell {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

@Injectable()
export class StockReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly movements: StockMovementsService,
    private readonly customFieldValues: CustomFieldValuesService,
  ) {}

  private async companyTimezone(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return company?.timezone ?? 'America/Sao_Paulo';
  }

  // Indicadores atuais. Valor total e SKUs com saldo incluem produtos INATIVOS que ainda têm saldo
  // (patrimônio armazenado não some por o produto estar inativo); baixo/esgotado contam só ativos.
  // Produtos na lixeira/arquivados sempre têm saldo zero (a lixeira exige isso), então não somam.
  async overview(user: AuthenticatedUser) {
    const result = await runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const [totals] = await tx.$queryRawUnsafe<Array<Record<string, string | number>>>(
        `SELECT
           count(*) FILTER (WHERE status = 'ACTIVE' AND "trashedAt" IS NULL AND "archivedAt" IS NULL)::int AS "activeProducts",
           count(*) FILTER (WHERE status = 'INACTIVE' AND "trashedAt" IS NULL AND "archivedAt" IS NULL)::int AS "inactiveProducts",
           count(*) FILTER (WHERE "balance" > 0)::int AS "skusWithStock",
           count(*) FILTER (WHERE status = 'INACTIVE' AND "balance" > 0)::int AS "inactiveWithStock",
           count(*) FILTER (WHERE status = 'ACTIVE' AND "trashedAt" IS NULL AND "archivedAt" IS NULL
                            AND "balance" > 0 AND "minStock" IS NOT NULL AND "balance" <= "minStock")::int AS "lowStock",
           count(*) FILTER (WHERE status = 'ACTIVE' AND "trashedAt" IS NULL AND "archivedAt" IS NULL AND "balance" = 0)::int AS "outOfStock",
           count(*) FILTER (WHERE "trashedAt" IS NOT NULL AND "archivedAt" IS NULL)::int AS "inTrash",
           coalesce(sum("stockValue"), 0)::text AS "totalValue"
         FROM "Product" WHERE "companyId" = $1`,
        user.companyId,
      );
      const byUnit = await tx.$queryRawUnsafe<Array<{ unit: string; quantity: string; products: number }>>(
        `SELECT unit, sum("balance")::text AS quantity, count(*)::int AS products
         FROM "Product" WHERE "companyId" = $1 AND "balance" > 0 GROUP BY unit ORDER BY unit`,
        user.companyId,
      );
      return { totals, byUnit };
    });
    const t = result.totals;
    return {
      activeProducts: Number(t.activeProducts),
      inactiveProducts: Number(t.inactiveProducts),
      skusWithStock: Number(t.skusWithStock),
      inactiveWithStock: Number(t.inactiveWithStock),
      lowStock: Number(t.lowStock),
      outOfStock: Number(t.outOfStock),
      inTrash: Number(t.inTrash),
      quantityByUnit: result.byUnit.map((r) => ({ unit: r.unit, quantity: Number(r.quantity), products: r.products })),
      ...(canSeeCosts(user) ? { totalValue: Number(new Prisma.Decimal(String(t.totalValue)).toFixed(2)) } : {}),
    };
  }

  // Reposição: produtos ativos com estoque baixo ou esgotados. "Quantidade para atingir o alvo" =
  // alvo − saldo, quando há alvo. Não considera pedidos de compra, reservas nem previsão de demanda.
  async replenishment(user: AuthenticatedUser) {
    const [low, out] = await Promise.all([
      this.products.findAll(user, { situation: 'LOW', page: 1, pageSize: 100_000 }),
      this.products.findAll(user, { situation: 'OUT_OF_STOCK', page: 1, pageSize: 100_000 }),
    ]);
    return [...out.items, ...low.items].map((p) => ({
      ...p,
      supplierName: null, // não existe cadastro de fornecedores nesta versão
      quantityToTarget:
        p.targetStock !== null ? Math.max(0, Number(new Prisma.Decimal(p.targetStock).sub(p.balance).toFixed(3))) : null,
    }));
  }

  parsePeriod(from?: string, to?: string): { from: Date; to: Date } {
    if (!from || !to) throw new BadRequestException('Informe o início e o fim do período.');
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Data de início do período inválida.');
    if (Number.isNaN(end.getTime())) throw new BadRequestException('Data de fim do período inválida.');
    if (start >= end) throw new BadRequestException('O início do período precisa ser antes do fim.');
    if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`O período pode ter no máximo ${MAX_PERIOD_DAYS} dias.`);
    }
    return { from: start, to: end };
  }

  async periodSummary(user: AuthenticatedUser, fromRaw?: string, toRaw?: string) {
    const { from, to } = this.parsePeriod(fromRaw, toRaw);
    // Inclui movimentações de produtos excluídos/arquivados: a exclusão nunca muda totais históricos.
    const rows = await runTenantInteractiveTransaction(this.prisma, (tx) =>
      tx.$queryRawUnsafe<Array<PeriodRow & { count: number }>>(
        `SELECT m.type, m.reason, o.type AS "origType", o.reason AS "origReason",
                (CASE WHEN m.type = 'REVERSAL' THEN o."quantityDelta" > 0 ELSE m."quantityDelta" > 0 END) AS positive,
                p.unit,
                abs(sum(m."quantityDelta"))::text AS quantity,
                abs(sum(m."valueDelta"))::text AS value,
                count(*)::int AS count
         FROM "StockMovement" m
         JOIN "Product" p ON p.id = m."productId"
         LEFT JOIN "StockMovement" o ON o.id = m."reversalOfId"
         WHERE m."companyId" = $1 AND m."createdAt" >= $2 AND m."createdAt" <= $3
         GROUP BY m.type, m.reason, o.type, o.reason, positive, p.unit`,
        user.companyId,
        from,
        to,
      ),
    );
    const summary = summarizePeriod(rows);
    const showCosts = canSeeCosts(user);
    const part = (p: { quantity: Prisma.Decimal; value: Prisma.Decimal; count: number }) => ({
      quantity: Number(p.quantity.toFixed(3)),
      count: p.count,
      ...(showCosts ? { value: Number(p.value.toFixed(2)) } : {}),
    });
    return {
      period: { from, to },
      categories: Object.fromEntries(
        SUMMARY_CATEGORIES.map((c) => [
          c,
          Object.entries(summary[c]).map(([unit, b]) => ({
            unit, original: part(b.original), reversed: part(b.reversed), net: part(b.net),
          })),
        ]),
      ),
    };
  }

  // ---- CSV -------------------------------------------------------------------------------------

  async positionCsv(user: AuthenticatedUser, query: QueryProductsDto): Promise<Buffer> {
    const showCosts = canSeeCosts(user);
    const { items } = await this.products.findAll(user, { ...query, page: 1, pageSize: CSV_MAX_ROWS });
    const definitions = await this.customFieldValues.getActiveDefinitions('product');
    const values = await this.customFieldValues.getValuesForRecords('product', items.map((p) => p.id));
    const header = [
      'SKU', 'Produto', 'Código de barras', 'Categoria', 'Marca', 'Unidade', 'Situação do cadastro',
      'Situação do estoque', 'Saldo', 'Estoque mínimo', 'Estoque alvo', 'Localização', 'Preço de venda',
      ...(showCosts ? ['Custo de referência', 'Custo médio', 'Valor em estoque'] : []),
      ...definitions.map((d) => d.displayName),
    ];
    const rows: CsvCell[][] = items.map((p) => {
      const cf = values.get(p.id) ?? {};
      const costs = p as typeof p & { referenceCost?: number | null; averageCost?: number; stockValue?: number };
      return [
        p.sku, p.name, p.barcode, p.categoryName, p.brandName, p.unit, LIFECYCLE_LABELS[p.lifecycle],
        SITUATION_LABELS[p.situation], p.balance, p.minStock, p.targetStock, p.location,
        p.salePrice === null ? null : csvNumber(p.salePrice, 2),
        ...(showCosts
          ? [
              costs.referenceCost === null || costs.referenceCost === undefined ? null : csvNumber(costs.referenceCost, 4),
              csvNumber(costs.averageCost ?? 0, 4),
              csvNumber(costs.stockValue ?? 0, 2),
            ]
          : []),
        ...definitions.map((d) => customFieldText(cf[d.columnName])),
      ];
    });
    return buildCsv(header, rows);
  }

  async movementsCsv(user: AuthenticatedUser, query: QueryMovementsDto): Promise<Buffer> {
    const showCosts = canSeeCosts(user);
    const tz = await this.companyTimezone(user.companyId);
    const { items } = await this.movements.findAll(user, { ...query, page: 1, pageSize: CSV_MAX_ROWS });
    const header = [
      'Data e hora', 'SKU', 'Produto', 'Situação do produto', 'Unidade', 'Tipo', 'Motivo', 'Quantidade',
      'Saldo anterior', 'Saldo posterior',
      ...(showCosts ? ['Custo unitário aplicado', 'Impacto no valor', 'Valor anterior', 'Valor posterior', 'Custo médio anterior', 'Custo médio posterior'] : []),
      'Responsável', 'Referência', 'Observação', 'Estorno de', 'Estornada por', 'ID',
    ];
    const rows: CsvCell[][] = items.map((m) => {
      const c = m as typeof m & Record<string, number | undefined>;
      return [
        formatDateTime(new Date(m.createdAt), tz), m.productSku, m.productName,
        m.productLifecycle ? LIFECYCLE_LABELS[m.productLifecycle] : '', m.productUnit,
        MOVEMENT_TYPE_LABELS[m.type as StockMovementType], MOVEMENT_REASON_LABELS[m.reason as StockMovementReason],
        m.quantityDelta, m.balanceBefore, m.balanceAfter,
        ...(showCosts
          ? [
              csvNumber(c.unitCost ?? 0, 4), csvNumber(c.valueDelta ?? 0, 2), csvNumber(c.valueBefore ?? 0, 2),
              csvNumber(c.valueAfter ?? 0, 2), csvNumber(c.averageCostBefore ?? 0, 4), csvNumber(c.averageCostAfter ?? 0, 4),
            ]
          : []),
        m.performedByName, m.documentRef, m.notes, m.reversalOfId, m.reversedById, m.id,
      ];
    });
    return buildCsv(header, rows);
  }

  async replenishmentCsv(user: AuthenticatedUser): Promise<Buffer> {
    const items = await this.replenishment(user);
    const header = ['SKU', 'Produto', 'Unidade', 'Situação', 'Saldo', 'Estoque mínimo', 'Estoque alvo', 'Quantidade para atingir o alvo', 'Fornecedor principal'];
    const rows: CsvCell[][] = items.map((p) => [
      p.sku, p.name, p.unit, SITUATION_LABELS[p.situation], p.balance, p.minStock, p.targetStock, p.quantityToTarget, p.supplierName,
    ]);
    return buildCsv(header, rows);
  }
}
