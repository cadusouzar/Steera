import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product, ProductStatus, StockMovementReason, StockMovementType } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CustomFieldValuesService } from '../custom-fields/custom-field-values.service';
import { detectRealMimeType } from '../files/file-signature.util';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { CreateProductDto, QueryProductsDto, UpdateProductDto } from './dto/product.dto';
import { computeIncoming, Dec, INPUT_COST_DP, MONEY_DP, parseMoney, parseQuantity } from './stock-math.util';
import { lockProduct, StockMovementsService } from './stock-movements.service';
import { canSeeCosts, presentProduct } from './stock-presenter';
import { StockSituation } from './stock-situation.util';
import { getStockUnit } from './stock-units';

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._\-/]*$/;
const AUTO_SKU_PREFIX = 'PRD-';

export function normalizeSku(raw: string): string {
  const sku = raw.trim().toUpperCase().replace(/\s+/g, '-');
  if (!SKU_PATTERN.test(sku)) {
    throw new BadRequestException('O SKU aceita letras, números e os símbolos . _ - / (começando por letra ou número)');
  }
  return sku;
}

export function trashDeadline(trashedAt: Date): Date {
  return new Date(trashedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS);
}

interface UploadedImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// Condições SQL (sempre sobre colunas fixas, nunca entrada do usuário) de cada situação de estoque.
// Espelham stockSituationOf (stock-situation.util.ts).
const SITUATION_SQL: Record<Exclude<StockSituation, 'NOT_APPLICABLE'>, string> = {
  OUT_OF_STOCK: `"balance" = 0`,
  LOW: `"balance" > 0 AND "minStock" IS NOT NULL AND "balance" <= "minStock"`,
  NO_MIN_ALERT: `"balance" > 0 AND "minStock" IS NULL`,
  NORMAL: `"balance" > 0 AND "minStock" IS NOT NULL AND "balance" > "minStock"`,
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movements: StockMovementsService,
    private readonly customFieldValues: CustomFieldValuesService,
    private readonly files: FilesService,
  ) {}

  // ---- validação de campos nativos -------------------------------------------------------------

  private async assertTaxonomy(companyId: string, categoryId?: string | null, brandId?: string | null) {
    if (categoryId) {
      const found = await this.prisma.productCategory.findFirst({ where: { id: categoryId, companyId } });
      if (!found) throw new BadRequestException('Categoria não encontrada');
    }
    if (brandId) {
      const found = await this.prisma.productBrand.findFirst({ where: { id: brandId, companyId } });
      if (!found) throw new BadRequestException('Marca não encontrada');
    }
  }

  private parseOptionalQty(raw: string | null | undefined, unit: string, field: string): Dec | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    return parseQuantity(raw, unit, { allowZero: true, field });
  }

  private parseOptionalMoney(raw: string | null | undefined, field: string, dp: number): Dec | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    return parseMoney(raw, field, dp);
  }

  private assertMinTarget(min: Dec | null, target: Dec | null) {
    if (min !== null && target !== null && target.lt(min)) {
      throw new BadRequestException('O estoque alvo não pode ser menor que o estoque mínimo');
    }
  }

  private assertCostWritable(user: AuthenticatedUser, referenceCost: unknown) {
    if (referenceCost !== undefined && referenceCost !== null && !canSeeCosts(user)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_REQUIRED',
        message: 'Seu perfil não permite ver ou alterar custos do estoque.',
      });
    }
  }

  // Próximo PRD-000001, PRD-000002... sob trava por empresa (dois cadastros simultâneos nunca geram
  // o mesmo código). Um SKU digitado à mão que coincida com o padrão também é considerado.
  private async nextSku(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'stock:sku:' + companyId}))`;
    const rows = await tx.product.findMany({ where: { companyId, sku: { startsWith: AUTO_SKU_PREFIX } }, select: { sku: true } });
    let max = 0;
    for (const { sku } of rows) {
      const n = Number(sku.slice(AUTO_SKU_PREFIX.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
    return `${AUTO_SKU_PREFIX}${String(max + 1).padStart(6, '0')}`;
  }

  private skuConflict(err: unknown, sku?: string): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(
        `Já existe um produto com o SKU ${sku ?? ''} nesta empresa (inclusive na lixeira ou arquivado).`.replace('  ', ' '),
      );
    }
    throw err;
  }

  // ---- cadastro --------------------------------------------------------------------------------

  async create(user: AuthenticatedUser, dto: CreateProductDto) {
    const companyId = user.companyId;
    const unit = dto.unit ?? 'UN';
    getStockUnit(unit);
    this.assertCostWritable(user, dto.referenceCost);
    await this.assertTaxonomy(companyId, dto.categoryId, dto.brandId);

    const referenceCost = this.parseOptionalMoney(dto.referenceCost, 'Custo de referência', INPUT_COST_DP) ?? null;
    const salePrice = this.parseOptionalMoney(dto.salePrice, 'Preço de venda', MONEY_DP) ?? null;
    const minStock = this.parseOptionalQty(dto.minStock, unit, 'Estoque mínimo') ?? null;
    const targetStock = this.parseOptionalQty(dto.targetStock, unit, 'Estoque alvo') ?? null;
    this.assertMinTarget(minStock, targetStock);

    const initialQuantity = this.parseOptionalQty(dto.initialQuantity, unit, 'Quantidade inicial') ?? null;
    const hasInitial = initialQuantity !== null && initialQuantity.gt(0);
    let initialUnitCost: Dec | null = null;
    if (hasInitial) {
      if (!('estoque.movimentar' in (user.permissions ?? {}))) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'PERMISSION_REQUIRED',
          message: 'Seu perfil não permite registrar entradas de estoque. Cadastre o produto sem quantidade inicial.',
        });
      }
      if (dto.initialUnitCost === undefined || dto.initialUnitCost === null) {
        throw new BadRequestException('Informe o custo unitário do saldo inicial');
      }
      initialUnitCost = parseMoney(dto.initialUnitCost, 'Custo unitário do saldo inicial', INPUT_COST_DP);
    }

    const sku = dto.sku ? normalizeSku(dto.sku) : undefined;
    const resolvedCustomFields = await this.customFieldValues.resolveValuesForCreate('product', dto.customFields);
    const actor = await this.movements.resolveActor(user);

    let id: string;
    try {
      id = await runTenantInteractiveTransaction(this.prisma, async (tx) => {
        const product = await tx.product.create({
          data: {
            companyId,
            name: dto.name,
            sku: sku ?? (await this.nextSku(tx, companyId)),
            barcode: dto.barcode ?? null,
            description: dto.description ?? null,
            categoryId: dto.categoryId ?? null,
            brandId: dto.brandId ?? null,
            unit,
            status: dto.status ?? ProductStatus.ACTIVE,
            location: dto.location ?? null,
            referenceCost,
            salePrice,
            minStock,
            targetStock,
            createdByUserId: user.userId,
          },
        });
        await this.customFieldValues.setValues('product', product.id, resolvedCustomFields, tx);
        if (hasInitial) {
          // Mesma transação do cadastro: ou o produto nasce com o saldo inicial registrado, ou nada é gravado.
          await this.movements.applyLocked(tx, product, actor, {
            type: StockMovementType.INITIAL,
            reason: StockMovementReason.INITIAL_BALANCE,
            quantity: initialQuantity!,
            effect: computeIncoming(product, initialQuantity!, initialUnitCost!),
            notes: 'Saldo inicial informado no cadastro',
          });
        }
        return product.id;
      });
    } catch (err) {
      this.skuConflict(err, sku);
    }
    return this.findOne(user, id);
  }

  // ---- consulta --------------------------------------------------------------------------------

  private async idsMatchingSituation(companyId: string, situation: Exclude<StockSituation, 'NOT_APPLICABLE'>): Promise<string[]> {
    const sql = `SELECT id FROM "Product" WHERE "companyId" = $1 AND status = 'ACTIVE' AND "trashedAt" IS NULL AND "archivedAt" IS NULL AND ${SITUATION_SQL[situation]}`;
    const rows = await runTenantInteractiveTransaction(this.prisma, (tx) => tx.$queryRawUnsafe<Array<{ id: string }>>(sql, companyId));
    return rows.map((r) => r.id);
  }

  async findAll(user: AuthenticatedUser, query: QueryProductsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const and: Prisma.ProductWhereInput[] = [{ companyId: user.companyId }];
    const view = query.selectable ? 'current' : (query.view ?? 'current');
    if (view === 'current') and.push({ trashedAt: null, archivedAt: null });
    if (view === 'deleted') and.push({ OR: [{ trashedAt: { not: null } }, { archivedAt: { not: null } }] });
    if (query.status) and.push({ status: query.status });
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.brandId) and.push({ brandId: query.brandId });
    const search = query.search?.trim();
    if (search) {
      and.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search } },
        ],
      });
    }
    if (query.situation === 'NOT_APPLICABLE') {
      and.push({ OR: [{ status: ProductStatus.INACTIVE }, { trashedAt: { not: null } }, { archivedAt: { not: null } }] });
    } else if (query.situation) {
      and.push({ id: { in: await this.idsMatchingSituation(user.companyId, query.situation) } });
    }
    const where: Prisma.ProductWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { category: true, brand: true },
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    const showCosts = canSeeCosts(user);
    return { items: items.map((p) => presentProduct(p, showCosts)), total, page, pageSize };
  }

  // Leitura por código exato (SKU ou código de barras) — leitores de código de barras funcionam como
  // teclado e enviam o código inteiro + Enter; a tela usa isto para abrir o produto direto.
  async findByCode(user: AuthenticatedUser, code: string) {
    const trimmed = code.trim();
    if (!trimmed) throw new NotFoundException('Produto não encontrado');
    const product = await this.prisma.product.findFirst({
      where: {
        companyId: user.companyId,
        trashedAt: null,
        archivedAt: null,
        OR: [{ sku: trimmed.toUpperCase() }, { barcode: trimmed }],
      },
      include: { category: true, brand: true },
    });
    if (!product) throw new NotFoundException('Nenhum produto com esse código');
    return presentProduct(product, canSeeCosts(user));
  }

  private async assertExists(companyId: string, id: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({ where: { id, companyId } });
    if (!product) throw new NotFoundException('Produto não encontrado');
    return product;
  }

  // Campos personalizados obrigatórios ATIVOS sem valor neste produto — sinalizados na ficha e ao
  // restaurar da lixeira (um campo obrigatório pode ter sido criado depois que o produto foi excluído).
  private async missingRequiredCustomFields(values: Record<string, unknown>) {
    const definitions = await this.customFieldValues.getActiveDefinitions('product');
    return definitions
      .filter((d) => d.required)
      .filter((d) => {
        const v = values[d.columnName];
        return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
      })
      .map((d) => ({ columnName: d.columnName, displayName: d.displayName }));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId: user.companyId },
      include: { category: true, brand: true },
    });
    if (!product) throw new NotFoundException('Produto não encontrado');
    const customFieldsMap = await this.customFieldValues.getValuesForRecords('product', [id]);
    const customFields = customFieldsMap.get(id) ?? {};
    const reversibleMovementId = product.lastSequence > 0 && !product.trashedAt && !product.archivedAt
      ? await this.movements.reversibleMovementIdOf(id)
      : null;
    return presentProduct(product, canSeeCosts(user), {
      customFields,
      missingRequiredCustomFields: await this.missingRequiredCustomFields(customFields),
      reversibleMovementId,
      restoreDeadline: product.trashedAt && !product.archivedAt ? trashDeadline(product.trashedAt) : null,
      afterTrashOutcome: product.trashedAt && !product.archivedAt ? (product.lastSequence > 0 ? 'ARCHIVE' : 'DELETE') : null,
    });
  }

  // ---- edição ----------------------------------------------------------------------------------

  async update(user: AuthenticatedUser, id: string, dto: UpdateProductDto) {
    const companyId = user.companyId;
    const current = await this.assertExists(companyId, id);
    if (current.trashedAt || current.archivedAt) {
      throw new ConflictException('Produto na lixeira ou arquivado não pode ser editado');
    }
    this.assertCostWritable(user, dto.referenceCost);
    await this.assertTaxonomy(companyId, dto.categoryId, dto.brandId);
    const { customFields, ...native } = dto;
    const sku = native.sku !== undefined ? normalizeSku(native.sku) : undefined;
    const unit = native.unit ?? current.unit;
    getStockUnit(unit);

    try {
      await runTenantInteractiveTransaction(this.prisma, async (tx) => {
        // Mesma trava das movimentações: a unidade só pode mudar enquanto não há nenhuma.
        const locked = await lockProduct(tx, companyId, id);
        if (unit !== locked.unit && locked.lastSequence > 0) {
          throw new ConflictException('A unidade não pode ser alterada depois que o produto teve movimentações');
        }
        const minStock = native.minStock !== undefined
          ? this.parseOptionalQty(native.minStock, unit, 'Estoque mínimo') ?? null
          : locked.minStock;
        const targetStock = native.targetStock !== undefined
          ? this.parseOptionalQty(native.targetStock, unit, 'Estoque alvo') ?? null
          : locked.targetStock;
        // Revalida os valores atuais contra uma unidade nova (ex.: 1,5 KG não cabe em UN).
        if (minStock !== null) parseQuantity(minStock.toString(), unit, { allowZero: true, field: 'Estoque mínimo' });
        if (targetStock !== null) parseQuantity(targetStock.toString(), unit, { allowZero: true, field: 'Estoque alvo' });
        this.assertMinTarget(minStock, targetStock);

        const data: Prisma.ProductUpdateInput = {
          ...(native.name !== undefined ? { name: native.name } : {}),
          ...(sku !== undefined ? { sku } : {}),
          ...(native.barcode !== undefined ? { barcode: native.barcode } : {}),
          ...(native.description !== undefined ? { description: native.description } : {}),
          ...(native.categoryId !== undefined ? { category: native.categoryId ? { connect: { id: native.categoryId } } : { disconnect: true } } : {}),
          ...(native.brandId !== undefined ? { brand: native.brandId ? { connect: { id: native.brandId } } : { disconnect: true } } : {}),
          ...(native.unit !== undefined ? { unit } : {}),
          ...(native.location !== undefined ? { location: native.location } : {}),
          ...(native.referenceCost !== undefined
            ? { referenceCost: this.parseOptionalMoney(native.referenceCost, 'Custo de referência', INPUT_COST_DP) }
            : {}),
          ...(native.salePrice !== undefined ? { salePrice: this.parseOptionalMoney(native.salePrice, 'Preço de venda', MONEY_DP) } : {}),
          minStock,
          targetStock,
        };
        await tx.product.update({ where: { id }, data });
        // Só as colunas enviadas mudam: editar campos nativos nunca apaga valores personalizados.
        if (customFields) await this.customFieldValues.setValues('product', id, customFields, tx);
      });
    } catch (err) {
      this.skuConflict(err, sku);
    }
    return this.findOne(user, id);
  }

  async setStatus(user: AuthenticatedUser, id: string, status: ProductStatus) {
    const product = await this.assertExists(user.companyId, id);
    if (product.trashedAt || product.archivedAt) throw new ConflictException('Produto na lixeira ou arquivado');
    if (product.status === status) {
      throw new ConflictException(status === ProductStatus.ACTIVE ? 'O produto já está ativo' : 'O produto já está inativo');
    }
    await this.prisma.product.update({ where: { id }, data: { status } });
    return this.findOne(user, id);
  }

  // ---- foto ------------------------------------------------------------------------------------

  async setPhoto(user: AuthenticatedUser, id: string, file: UploadedImage | undefined) {
    if (!file) throw new BadRequestException('Envie uma imagem');
    const product = await this.assertExists(user.companyId, id);
    if (product.trashedAt || product.archivedAt) throw new ConflictException('Produto na lixeira ou arquivado');
    const mime = detectRealMimeType(file.buffer);
    if (mime !== 'image/jpeg' && mime !== 'image/png') throw new BadRequestException('A foto precisa ser JPG ou PNG');
    const asset = await this.files.upload(user.companyId, user.userId, file, 'PRODUCT_PHOTO');
    await this.prisma.product.update({ where: { id }, data: { photoAssetId: asset.id } });
    // A foto anterior pertencia só a este produto.
    if (product.photoAssetId) await this.files.deleteAsset(product.photoAssetId, user.companyId);
    return this.findOne(user, id);
  }

  async removePhoto(user: AuthenticatedUser, id: string) {
    const product = await this.assertExists(user.companyId, id);
    if (product.trashedAt || product.archivedAt) throw new ConflictException('Produto na lixeira ou arquivado');
    if (!product.photoAssetId) return this.findOne(user, id);
    await this.prisma.product.update({ where: { id }, data: { photoAssetId: null } });
    await this.files.deleteAsset(product.photoAssetId, user.companyId);
    return this.findOne(user, id);
  }

  // ---- lixeira ---------------------------------------------------------------------------------

  async trash(user: AuthenticatedUser, id: string) {
    const actor = await this.movements.resolveActor(user);
    await runTenantInteractiveTransaction(this.prisma, async (tx) => {
      // Mesma trava das movimentações: nenhuma entrada pode passar entre a checagem do saldo e o envio.
      const product = await lockProduct(tx, user.companyId, id);
      if (product.archivedAt) throw new ConflictException('Produto arquivado');
      if (product.trashedAt) throw new ConflictException('O produto já está na lixeira');
      if (!product.balance.isZero()) {
        throw new ConflictException({
          statusCode: 409,
          code: 'STOCK_NOT_ZERO',
          message:
            'Este produto ainda tem saldo em estoque. Regularize o saldo com uma saída ou um ajuste justificado antes de excluir.',
          balance: Number(product.balance),
        });
      }
      // Nenhum vínculo operacional impeditivo existe nesta versão (sem vendas/compras/reservas).
      await tx.product.update({
        where: { id },
        data: { trashedAt: new Date(), trashedByUserId: actor.userId, trashedByName: actor.name },
      });
    });
    return this.findOne(user, id);
  }

  async restore(user: AuthenticatedUser, id: string) {
    await runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const product = await lockProduct(tx, user.companyId, id);
      if (product.archivedAt) {
        throw new ConflictException('Produto arquivado permanentemente não pode ser restaurado nesta versão');
      }
      if (!product.trashedAt) throw new ConflictException('O produto não está na lixeira');
      if (trashDeadline(product.trashedAt).getTime() < Date.now()) {
        throw new ConflictException('O prazo de restauração de 30 dias terminou');
      }
      // O SKU ficou reservado durante a lixeira, então não há conflito de código. O status anterior
      // (ativo/inativo) nunca mudou — volta como estava. Nenhuma movimentação é gerada.
      await tx.product.update({
        where: { id },
        data: { trashedAt: null, trashedByUserId: null, trashedByName: null },
      });
    });
    return this.findOne(user, id);
  }

  async findTrash(user: AuthenticatedUser, purge: (companyId: string) => Promise<unknown>) {
    await purge(user.companyId);
    const items = await this.prisma.product.findMany({
      where: { companyId: user.companyId, trashedAt: { not: null }, archivedAt: null },
      include: { category: true, brand: true },
      orderBy: { trashedAt: 'asc' },
    });
    const now = Date.now();
    const showCosts = canSeeCosts(user);
    return items.map((p) => {
      const deadline = trashDeadline(p.trashedAt!);
      return presentProduct(p, showCosts, {
        restoreDeadline: deadline,
        daysLeft: Math.max(0, Math.ceil((deadline.getTime() - now) / DAY_MS)),
        afterTrashOutcome: p.lastSequence > 0 ? 'ARCHIVE' : 'DELETE',
      });
    });
  }
}
