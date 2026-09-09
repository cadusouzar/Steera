import { Injectable, NotFoundException } from '@nestjs/common';
import { ReceivableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfToday } from '../receivables/receivables.service';
import { CreateClientDto } from './dto/create-client.dto';
import { QueryClientsDto } from './dto/query-clients.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateClientDto) {
    return this.prisma.client.create({ data: dto });
  }

  async findAll(query: QueryClientsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where = {
      ...(query.status ? { status: query.status } : {}),
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
}
