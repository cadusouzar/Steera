import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientStatus, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { runTenantTransaction } from '../prisma/tenant-rls.extension';
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
  ) {}

  async create(dto: CreateClientDto) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    return this.prisma.client.create({ data: { ...dto, companyId } });
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

    return { items, total, page, pageSize };
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

    return {
      ...client,
      totalPaid: Number(paidAgg._sum.amount ?? 0),
      totalPending: Number(pendingAgg._sum.amount ?? 0),
      totalOverdue: Number(overdueAgg._sum.amount ?? 0),
    };
  }

  async update(id: string, dto: UpdateClientDto) {
    await this.assertExists(id);
    return this.prisma.client.update({ where: { id }, data: dto });
  }

  async deactivate(id: string, dto: DeactivateClientDto) {
    const client = await this.assertExists(id);
    if (client.status === ClientStatus.INACTIVE) {
      throw new ConflictException(`Cliente ${id} já está inativo`);
    }

    const [updatedClient] = await runTenantTransaction(this.prisma, [
      this.prisma.client.update({
        where: { id },
        data: {
          status: ClientStatus.INACTIVE,
          includeInRevenueReport: dto.includeInRevenueReport,
          deactivatedAt: new Date(),
        },
      }),
      this.prisma.subscription.updateMany({
        where: { clientId: id, status: SubscriptionStatus.ACTIVE },
        data: { status: SubscriptionStatus.INACTIVE },
      }),
    ]);

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
