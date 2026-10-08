import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export type TaxonomyKind = 'category' | 'brand';

const LABEL: Record<TaxonomyKind, { one: string; article: string }> = {
  category: { one: 'categoria', article: 'a' },
  brand: { one: 'marca', article: 'a' },
};

// Categorias e marcas de produto: listas reutilizáveis por empresa, criadas direto do cadastro do
// produto. Nome único por empresa sem diferenciar maiúsculas/minúsculas ("Bebidas" = "bebidas").
@Injectable()
export class ProductTaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  private delegate(kind: TaxonomyKind) {
    // As duas tabelas têm exatamente o mesmo formato (id, companyId, name).
    return (kind === 'category' ? this.prisma.productCategory : this.prisma.productBrand) as unknown as Prisma.ProductCategoryDelegate;
  }

  async list(user: AuthenticatedUser, kind: TaxonomyKind) {
    const rows = await this.delegate(kind).findMany({
      where: { companyId: user.companyId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, productCount: r._count.products }));
  }

  private async assertNameFree(companyId: string, kind: TaxonomyKind, name: string, exceptId?: string) {
    const clash = await this.delegate(kind).findFirst({
      where: { companyId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    });
    if (clash) throw new ConflictException(`Já existe ${LABEL[kind].article} ${LABEL[kind].one} "${clash.name}"`);
  }

  async create(user: AuthenticatedUser, kind: TaxonomyKind, name: string) {
    await this.assertNameFree(user.companyId, kind, name);
    try {
      const row = await this.delegate(kind).create({ data: { companyId: user.companyId, name } });
      return { id: row.id, name: row.name, productCount: 0 };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Já existe ${LABEL[kind].article} ${LABEL[kind].one} com esse nome`);
      }
      throw err;
    }
  }

  private async assertExists(companyId: string, kind: TaxonomyKind, id: string) {
    const row = await this.delegate(kind).findFirst({ where: { id, companyId } });
    if (!row) throw new NotFoundException(`${LABEL[kind].one[0].toUpperCase()}${LABEL[kind].one.slice(1)} não encontrada`);
    return row;
  }

  async rename(user: AuthenticatedUser, kind: TaxonomyKind, id: string, name: string) {
    await this.assertExists(user.companyId, kind, id);
    await this.assertNameFree(user.companyId, kind, name, id);
    const row = await this.delegate(kind).update({ where: { id }, data: { name } });
    return { id: row.id, name: row.name };
  }

  // Só exclui o que nenhum produto (de nenhum estado, inclusive lixeira/arquivo) usa — nunca apaga
  // informação de produtos em silêncio.
  async remove(user: AuthenticatedUser, kind: TaxonomyKind, id: string) {
    await this.assertExists(user.companyId, kind, id);
    const inUse = await this.prisma.product.count({
      where: { companyId: user.companyId, ...(kind === 'category' ? { categoryId: id } : { brandId: id }) },
    });
    if (inUse > 0) {
      throw new ConflictException(`Esta ${LABEL[kind].one} está em uso por ${inUse} produto(s) e não pode ser excluída`);
    }
    await this.delegate(kind).delete({ where: { id } });
  }
}
