import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma, Product, StockMovement, StockMovementOrigin, StockMovementReason, StockMovementType,
} from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { AdjustmentMovementDto, EntryMovementDto, ExitMovementDto, QueryMovementsDto, ReverseMovementDto } from './dto/movement.dto';
import {
  averageCostOf, computeIncoming, computeOutgoing, computeReversal, Dec, INPUT_COST_DP, parseMoney, parseQuantity, StockEffect,
} from './stock-math.util';
import { canSeeCosts, presentMovement } from './stock-presenter';

// Quem registrou: nome (ou e-mail) congelado na movimentação — User é tabela central, sem FK
// cross-schema, e o histórico precisa continuar legível mesmo se o login for removido.
export interface StockActor {
  userId: string;
  name: string;
}

export interface ApplyMovementInput {
  type: StockMovementType;
  reason: StockMovementReason;
  effect: StockEffect;
  quantity: Dec; // magnitude
  notes?: string | null;
  documentRef?: string | null;
  requestId?: string | null;
  reversalOfId?: string | null;
  // Ponto de extensão para integrações futuras (vendas, compras): sempre passar por aqui.
  origin?: StockMovementOrigin;
  sourceType?: string | null;
  sourceId?: string | null;
}

// Trava de produto: TODA escrita que depende do saldo (movimentar, ajustar, estornar, enviar para a
// lixeira) pega esta mesma trava transacional antes de ler o produto, então duas operações
// simultâneas no mesmo produto sempre rodam uma depois da outra.
export async function lockProduct(tx: Prisma.TransactionClient, companyId: string, productId: string): Promise<Product> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock:product:' + productId}))`;
  const product = await tx.product.findFirst({ where: { id: productId, companyId } });
  if (!product) throw new NotFoundException('Produto não encontrado');
  return product;
}

export function assertMovable(product: Product): void {
  if (product.archivedAt) throw new ConflictException('Produto arquivado não recebe movimentações');
  if (product.trashedAt) throw new ConflictException('Produto na lixeira não recebe movimentações. Restaure-o antes.');
}

interface MovementLink {
  id: string;
  type: StockMovementType;
  reversalOfId: string | null;
}

// Estorno nesta versão: só a ÚLTIMA movimentação elegível do produto — a mais recente que não é um
// estorno nem já foi estornada, e depois da qual só existem pares (movimentação, estorno) já
// fechados. Como esses pares se anulam exatamente, o estado atual do produto é o estado logo depois
// dela, e o estorno devolve exatamente o estado anterior, sem recalcular nenhum histórico.
export function findReversibleMovementId(movementsDesc: MovementLink[]): string | null {
  const reversed = new Set<string>();
  for (const m of movementsDesc) {
    if (m.type === StockMovementType.REVERSAL) {
      if (m.reversalOfId) reversed.add(m.reversalOfId);
      continue;
    }
    if (reversed.has(m.id)) continue;
    return m.id;
  }
  return null;
}

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  // Fora de qualquer transação de tenant: User é central (ler tabela central dentro de uma transação
  // roteada para o schema da empresa quebra — ver DECISOES-TECNICAS).
  async resolveActor(user: AuthenticatedUser): Promise<StockActor> {
    const found = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, email: true } });
    return { userId: user.userId, name: found?.name?.trim() || found?.email || 'Usuário removido' };
  }

  // ÚNICO ponto que altera saldo/valor/custo médio de um produto. Deve rodar dentro de uma
  // transação de tenant, com o produto já travado (lockProduct) e lido nessa mesma transação.
  async applyLocked(
    tx: Prisma.TransactionClient,
    product: Product,
    actor: StockActor,
    input: ApplyMovementInput,
  ): Promise<StockMovement> {
    const { effect } = input;
    if (effect.after.balance.isNegative() || effect.after.stockValue.isNegative()) {
      throw new BadRequestException('A movimentação deixaria o saldo negativo');
    }
    const sequence = product.lastSequence + 1;
    const movement = await tx.stockMovement.create({
      data: {
        companyId: product.companyId,
        productId: product.id,
        sequence,
        type: input.type,
        reason: input.reason,
        quantity: input.quantity,
        quantityDelta: effect.quantityDelta,
        balanceBefore: product.balance,
        balanceAfter: effect.after.balance,
        unitCost: effect.unitCost,
        valueDelta: effect.valueDelta,
        valueBefore: product.stockValue,
        valueAfter: effect.after.stockValue,
        averageCostBefore: averageCostOf(product.balance, product.stockValue),
        averageCostAfter: effect.after.averageCost,
        notes: input.notes || null,
        documentRef: input.documentRef || null,
        performedByUserId: actor.userId,
        performedByName: actor.name,
        productNameAtTime: product.name,
        productSkuAtTime: product.sku,
        reversalOfId: input.reversalOfId ?? null,
        requestId: input.requestId ?? null,
        origin: input.origin ?? StockMovementOrigin.MANUAL,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
      },
    });
    // Guarda otimista além da trava: só atualiza se ninguém mexeu no produto desde a leitura.
    const updated = await tx.product.updateMany({
      where: { id: product.id, lastSequence: product.lastSequence },
      data: {
        balance: effect.after.balance,
        stockValue: effect.after.stockValue,
        averageCost: effect.after.averageCost,
        lastSequence: sequence,
      },
    });
    if (updated.count !== 1) throw new ConflictException('O produto foi alterado por outra operação. Tente novamente.');
    return movement;
  }

  // Reenvio idempotente: se esta empresa já gravou uma movimentação com este requestId, devolve a
  // mesma (sem aplicar de novo). Chamado DEPOIS da trava do produto, para que dois envios
  // simultâneos do mesmo pedido vejam um ao outro.
  private async findByRequestId(tx: Prisma.TransactionClient, companyId: string, requestId: string, productId: string) {
    const existing = await tx.stockMovement.findFirst({ where: { companyId, requestId } });
    if (existing && existing.productId !== productId) {
      throw new ConflictException('Este pedido já foi usado em outra movimentação');
    }
    return existing;
  }

  private async run(
    user: AuthenticatedUser,
    productId: string,
    requestId: string,
    build: (tx: Prisma.TransactionClient, product: Product) => Promise<ApplyMovementInput>,
  ) {
    const actor = await this.resolveActor(user);
    try {
      const movement = await runTenantInteractiveTransaction(this.prisma, async (tx) => {
        const product = await lockProduct(tx, user.companyId, productId);
        const existing = await this.findByRequestId(tx, user.companyId, requestId, productId);
        if (existing) return existing;
        assertMovable(product);
        const input = await build(tx, product);
        return this.applyLocked(tx, product, actor, { ...input, requestId });
      });
      return this.present(user, movement.id);
    } catch (err) {
      // Corrida residual (mesmo requestId em produtos diferentes ao mesmo tempo, ou estorno duplo
      // concorrente): os índices únicos do banco são a última barreira.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String((err.meta as { target?: unknown } | undefined)?.target ?? '');
        if (target.includes('reversalOfId')) throw new ConflictException('Esta movimentação já foi estornada');
        const again = await this.prisma.stockMovement.findFirst({ where: { companyId: user.companyId, requestId } });
        if (again && again.productId === productId) return this.present(user, again.id);
        throw new ConflictException('Não foi possível registrar a movimentação. Tente novamente.');
      }
      throw err;
    }
  }

  entry(user: AuthenticatedUser, productId: string, dto: EntryMovementDto) {
    return this.run(user, productId, dto.requestId, async (_tx, product) => {
      const quantity = parseQuantity(dto.quantity, product.unit);
      const unitCost = parseMoney(dto.unitCost, 'Custo unitário', INPUT_COST_DP);
      return {
        type: StockMovementType.ENTRY, reason: dto.reason, quantity,
        effect: computeIncoming(product, quantity, unitCost), notes: dto.notes, documentRef: dto.documentRef,
      };
    });
  }

  exit(user: AuthenticatedUser, productId: string, dto: ExitMovementDto) {
    return this.run(user, productId, dto.requestId, async (_tx, product) => {
      const quantity = parseQuantity(dto.quantity, product.unit);
      return {
        type: StockMovementType.EXIT, reason: dto.reason, quantity,
        effect: computeOutgoing(product, quantity), notes: dto.notes, documentRef: dto.documentRef,
      };
    });
  }

  adjust(user: AuthenticatedUser, productId: string, dto: AdjustmentMovementDto) {
    return this.run(user, productId, dto.requestId, async (_tx, product) => {
      const counted = parseQuantity(dto.countedQuantity, product.unit, { allowZero: true, field: 'Quantidade contada' });
      const expected = parseQuantity(dto.expectedBalance, product.unit, { allowZero: true, field: 'Saldo de referência' });
      if (!expected.eq(product.balance)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'STOCK_BALANCE_CHANGED',
          message: 'O saldo mudou enquanto a contagem estava aberta. Revise a diferença com o saldo atualizado.',
          currentBalance: Number(product.balance),
        });
      }
      const difference = counted.sub(product.balance);
      if (difference.isZero()) {
        throw new BadRequestException('A quantidade contada é igual ao saldo atual. Nenhum ajuste é necessário.');
      }
      let effect: StockEffect;
      if (difference.isNegative()) {
        effect = computeOutgoing(product, difference.abs());
      } else if (product.balance.gt(0)) {
        effect = computeIncoming(product, difference, averageCostOf(product.balance, product.stockValue));
      } else {
        if (!dto.unitCost || dto.unitCost.trim() === '') {
          throw new BadRequestException({
            statusCode: 400,
            code: 'UNIT_COST_REQUIRED',
            message: 'O saldo atual é zero, então não há custo médio. Informe o custo unitário dos itens encontrados.',
          });
        }
        effect = computeIncoming(product, difference, parseMoney(dto.unitCost, 'Custo unitário', INPUT_COST_DP));
      }
      return {
        type: StockMovementType.ADJUSTMENT, reason: StockMovementReason.COUNT_ADJUSTMENT, quantity: difference.abs(),
        effect, notes: dto.notes, documentRef: dto.documentRef,
      };
    });
  }

  async reverse(user: AuthenticatedUser, movementId: string, dto: ReverseMovementDto) {
    const original = await this.prisma.stockMovement.findFirst({ where: { id: movementId, companyId: user.companyId } });
    if (!original) throw new NotFoundException('Movimentação não encontrada');
    return this.run(user, original.productId, dto.requestId, async (tx) => {
      const fresh = await tx.stockMovement.findFirst({ where: { id: movementId }, include: { reversedBy: { select: { id: true } } } });
      if (!fresh) throw new NotFoundException('Movimentação não encontrada');
      if (fresh.type === StockMovementType.REVERSAL) throw new ConflictException('Um estorno não pode ser estornado');
      if (fresh.reversedBy) throw new ConflictException('Esta movimentação já foi estornada');
      const eligibleId = findReversibleMovementId(await this.linksDesc(tx, fresh.productId));
      if (eligibleId !== fresh.id) {
        throw new ConflictException('Nesta versão, só a última movimentação do produto pode ser estornada.');
      }
      const product = await tx.product.findFirstOrThrow({ where: { id: fresh.productId } });
      return {
        type: StockMovementType.REVERSAL, reason: StockMovementReason.REVERSAL, quantity: fresh.quantity,
        effect: computeReversal(product, fresh), notes: dto.notes, reversalOfId: fresh.id,
      };
    });
  }

  private linksDesc(tx: Prisma.TransactionClient | PrismaService, productId: string) {
    return tx.stockMovement.findMany({
      where: { productId },
      orderBy: { sequence: 'desc' },
      select: { id: true, type: true, reversalOfId: true },
    });
  }

  async reversibleMovementIdOf(productId: string): Promise<string | null> {
    return findReversibleMovementId(await this.linksDesc(this.prisma, productId));
  }

  private async present(user: AuthenticatedUser, movementId: string) {
    const m = await this.prisma.stockMovement.findFirstOrThrow({
      where: { id: movementId, companyId: user.companyId },
      include: { product: true, reversedBy: { select: { id: true } } },
    });
    return presentMovement(m, canSeeCosts(user));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const m = await this.prisma.stockMovement.findFirst({
      where: { id, companyId: user.companyId },
      include: { product: true, reversedBy: { select: { id: true } } },
    });
    if (!m) throw new NotFoundException('Movimentação não encontrada');
    const reversibleId = await this.reversibleMovementIdOf(m.productId);
    const original = m.reversalOfId
      ? await this.prisma.stockMovement.findFirst({ where: { id: m.reversalOfId, companyId: user.companyId }, include: { product: true } })
      : null;
    return presentMovement(m, canSeeCosts(user), {
      reversible: reversibleId === m.id && !m.product.trashedAt && !m.product.archivedAt,
      original: original ? presentMovement(original, canSeeCosts(user)) : null,
    });
  }

  buildWhere(companyId: string, query: QueryMovementsDto): Prisma.StockMovementWhereInput {
    return {
      companyId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.reason ? { reason: query.reason } : {}),
      ...(query.performedByUserId ? { performedByUserId: query.performedByUserId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    };
  }

  async findAll(user: AuthenticatedUser, query: QueryMovementsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(user.companyId, query);
    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { product: true, reversedBy: { select: { id: true } } },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    // Qual movimentação de cada produto da página ainda pode ser estornada.
    const productIds = [...new Set(items.map((i) => i.productId))];
    const reversible = new Map<string, string | null>();
    if (productIds.length > 0) {
      const links = await this.prisma.stockMovement.findMany({
        where: { companyId: user.companyId, productId: { in: productIds } },
        orderBy: { sequence: 'desc' },
        select: { id: true, type: true, reversalOfId: true, productId: true },
      });
      for (const pid of productIds) reversible.set(pid, findReversibleMovementId(links.filter((l) => l.productId === pid)));
    }
    const showCosts = canSeeCosts(user);
    return {
      items: items.map((m) =>
        presentMovement(m, showCosts, {
          reversible: reversible.get(m.productId) === m.id && !m.product.trashedAt && !m.product.archivedAt,
        }),
      ),
      total,
      page,
      pageSize,
    };
  }

  async listPerformers(user: AuthenticatedUser) {
    const rows = await this.prisma.stockMovement.findMany({
      where: { companyId: user.companyId },
      distinct: ['performedByUserId'],
      orderBy: { performedByUserId: 'asc' },
      select: { performedByUserId: true, performedByName: true },
    });
    return rows.map((r) => ({ userId: r.performedByUserId, name: r.performedByName })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
}
