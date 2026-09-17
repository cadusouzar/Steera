import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientStatus, Prisma, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { CustomFieldValuesService } from '../custom-fields/custom-field-values.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { startOfToday } from '../common/date.util';
import { ClientTrashService } from './client-trash.service';
import { CreateClientDto } from './dto/create-client.dto';
import { DeactivateClientDto } from './dto/deactivate-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly clientTrash: ClientTrashService,
    private readonly customFieldValues: CustomFieldValuesService,
  ) {}

  async create(dto: CreateClientDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const { customFields, ...nativeDto } = dto;
    const resolvedCustomFields = await this.customFieldValues.resolveValuesForCreate('client', customFields);

    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const created = await tx.client.create({ data: { ...nativeDto, companyId } });
      await this.customFieldValues.setValues('client', created.id, resolvedCustomFields, tx);
      return this.withCustomFields(created, tx);
    });
  }

  async findAll(query: QueryClientsDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.excludeTrashed
        ? { NOT: { status: ClientStatus.INACTIVE, includeInRevenueReport: false } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { category: { contains: query.search, mode: 'insensitive' as const } },
              { contact: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      this.prisma.client.count({ where }),
    ]);

    const customFieldsMap = await this.customFieldValues.getValuesForRecords('client', items.map((i) => i.id));
    const itemsWithCustomFields = items.map((item) => ({ ...item, customFields: customFieldsMap.get(item.id) ?? {} }));

    return { items: itemsWithCustomFields, total, page, pageSize };
  }

  // Rota top-level (/clients/:id) — o único jeito de barrar acesso entre
  // empresas aqui é filtrar por companyId diretamente nesta query (mesmo
  // padrão de RolesService.assertExists).
  private async assertExists(id: string) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    const client = await this.prisma.client.findFirst({ where: { id, companyId } });
    if (!client) throw new NotFoundException(`Cliente ${id} não encontrado`);
    return client;
  }

  async findOne(id: string) {
    const client = await this.assertExists(id);
    const today = startOfToday();

    const [paidAgg, pendingAgg, overdueAgg] = await Promise.all([
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { clientId: id, status: ReceivableStatus.PAID },
      }),
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { clientId: id, status: ReceivableStatus.PENDING, dueDate: { gte: today } },
      }),
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { clientId: id, status: ReceivableStatus.PENDING, dueDate: { lt: today } },
      }),
    ]);

    const customFieldsMap = await this.customFieldValues.getValuesForRecords('client', [id]);

    return {
      ...client,
      totalPaid: Number(paidAgg._sum.amount ?? 0),
      totalPending: Number(pendingAgg._sum.amount ?? 0),
      totalOverdue: Number(overdueAgg._sum.amount ?? 0),
      customFields: customFieldsMap.get(id) ?? {},
    };
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.assertExists(id);
    const { customFields, ...nativeDto } = dto;
    return runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const updated = await tx.client.update({ where: { id }, data: nativeDto });
      if (customFields) await this.customFieldValues.setValues('client', id, customFields, tx);
      return this.withCustomFields(updated, tx);
    });
  }

  // `tx` opcional: create/update já estão dentro de uma transação de tenant e passam a mesma pra
  // reaproveitar a conexão (ver o comentário em CustomFieldValuesService.getActiveDefinitions).
  private async withCustomFields<T extends { id: string }>(
    record: T,
    tx?: Prisma.TransactionClient,
  ): Promise<T & { customFields: Record<string, unknown> }> {
    const map = await this.customFieldValues.getValuesForRecords('client', [record.id], tx);
    return { ...record, customFields: map.get(record.id) ?? {} };
  }

  async deactivate(id: string, dto: DeactivateClientDto) {
    const client = await this.assertExists(id);
    if (client.status === ClientStatus.INACTIVE) {
      throw new ConflictException(`Cliente ${id} já está inativo`);
    }

    const updatedClient = await runTenantInteractiveTransaction(this.prisma, async (tx) => {
      const updated = await tx.client.update({
        where: { id },
        data: {
          status: ClientStatus.INACTIVE,
          includeInRevenueReport: dto.includeInRevenueReport,
          deactivatedAt: new Date(),
        },
      });
      await tx.subscription.updateMany({
        where: { clientId: id, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.INACTIVE },
      });
      return updated;
    });

    return updatedClient;
  }

  async restore(id: string) {
    const client = await this.assertExists(id);
    if (client.status === ClientStatus.ACTIVE) {
      throw new ConflictException(`Cliente ${id} já está ativo`);
    }
    return this.prisma.client.update({
      where: { id },
      data: { status: ClientStatus.ACTIVE, deactivatedAt: null },
    });
  }

  // A purga em si (ClientTrashService.purgeExpiredTrash) roda escopada pra
  // empresa desta própria requisição autenticada (TenantContextInterceptor
  // já estabeleceu esse contexto de tenant antes deste método rodar — ver o
  // backstop de RLS em prisma/tenant-rls.extension.ts) — só afeta clientes
  // desta empresa, não de todas de uma vez. O cron diário
  // (ClientTrashService.purgeExpiredTrashCron) é quem de fato varre todas as
  // empresas, iterando cada uma explicitamente via runWithTenant (rodando
  // fora de uma requisição HTTP, sem esse contexto automático). A listagem
  // que este método devolve também é escopada pra empresa autenticada.
  async findTrash() {
    await this.clientTrash.purgeExpiredTrash();
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.client.findMany({
      where: { companyId, status: ClientStatus.INACTIVE, includeInRevenueReport: false },
      orderBy: { deactivatedAt: 'asc' },
    });
  }
}
