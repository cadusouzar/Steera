import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClientStatus, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfToday } from '../receivables/receivables.service';
import { CreateClientDto } from './dto/create-client.dto';
import { DeactivateClientDto } from './dto/deactivate-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Daily safety net for the 30-day trash purge — findTrash() already
  // purges defensively on every read, so this only matters when nobody
  // opens the Lixeira for a while. Errors are logged, never thrown: a
  // failed purge attempt must not crash the whole backend process.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredTrashCron() {
    try {
      const count = await this.purgeExpiredTrash();
      if (count > 0) this.logger.log(`Purged ${count} client(s) from the trash`);
    } catch (err) {
      this.logger.error('Failed to purge expired client trash', err instanceof Error ? err.stack : String(err));
    }
  }

  create(dto: CreateClientDto) {
    return this.prisma.client.create({ data: dto });
  }

  async findAll(query: QueryClientsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
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

  private async assertExists(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
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

  // "Excluir Cliente" in the UI — logical deletion only. The client row and
  // every Receivable/Subscription it owns are preserved untouched; this only
  // flips status to INACTIVE and records the caller's explicit decision on
  // whether the client's historical numbers should still count toward the
  // company-wide financial report (includeInRevenueReport is independent of
  // status — never inferred from it).
  async deactivate(id: string, dto: DeactivateClientDto) {
    const client = await this.assertExists(id);
    if (client.status === ClientStatus.INACTIVE) {
      throw new ConflictException(`Cliente ${id} já está inativo`);
    }

    // Two records change together (the client itself, plus pausing its active
    // subscriptions so they stop generating new receivables for a client that
    // should no longer receive lançamentos) — done in one transaction so
    // neither can happen without the other.
    const [updatedClient] = await this.prisma.$transaction([
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

  // Reverses a deactivation — works for either group (kept in reports or
  // not). Never touches includeInRevenueReport: that decision stays
  // whatever it was set to at the last /deactivate call, independent of
  // status.
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

  // Only the "not kept in reports" group is ever auto-purged — clients
  // deactivated with includeInRevenueReport=true stay inactive forever
  // (purging them would destroy the history the user explicitly asked to
  // keep in the financial report). The FK cascade on Receivable/Subscription
  // (onDelete: Cascade) takes care of deleting their historical data too.
  async purgeExpiredTrash(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const result = await this.prisma.client.deleteMany({
      where: {
        status: ClientStatus.INACTIVE,
        includeInRevenueReport: false,
        deactivatedAt: { lt: cutoff },
      },
    });
    return result.count;
  }

  // The "Lixeira" view — only ever shows the group that's actually subject
  // to the 30-day auto-purge (includeInRevenueReport=false). Runs a
  // defensive purge first so the list — and the purge itself — stays
  // correct even if the daily cron missed a run (this is a local app, not
  // always running).
  async findTrash() {
    await this.purgeExpiredTrash();
    return this.prisma.client.findMany({
      where: { status: ClientStatus.INACTIVE, includeInRevenueReport: false },
      orderBy: { deactivatedAt: 'asc' },
    });
  }
}
