import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientStatus, Receivable, ReceivableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { QueryReceivablesDto } from './dto/query-receivables.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';

export type DerivedReceivableStatus = 'pending' | 'paid' | 'overdue';

// `dueDate` is `@db.Date` in Postgres and Prisma always reads those back as UTC
// midnight, so every date-only value handled here is normalized to UTC midnight
// too. Using local midnight would make a receivable due "today" compare as
// overdue in any timezone west of UTC (e.g. UTC-3).
export function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function deriveReceivableStatus(
  receivable: Pick<Receivable, 'status' | 'dueDate'>,
): DerivedReceivableStatus {
  if (receivable.status === ReceivableStatus.PAID) return 'paid';
  return receivable.dueDate < startOfToday() ? 'overdue' : 'pending';
}

function toResponse(receivable: Receivable) {
  return { ...receivable, derivedStatus: deriveReceivableStatus(receivable) };
}

@Injectable()
export class ReceivablesService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureClientExists(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client) throw new NotFoundException(`Cliente ${clientId} não encontrado`);
    return client;
  }

  private async assertExists(id: string): Promise<Receivable> {
    const found = await this.prisma.receivable.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Lançamento ${id} não encontrado`);
    return found;
  }

  async create(clientId: string, dto: CreateReceivableDto) {
    const client = await this.ensureClientExists(clientId);
    if (client.status === ClientStatus.INACTIVE) {
      throw new BadRequestException(`Não é possível criar lançamentos para o cliente ${clientId}: cliente inativo`);
    }
    const created = await this.prisma.receivable.create({
      data: { ...dto, dueDate: parseDateOnly(dto.dueDate), clientId },
    });
    return toResponse(created);
  }

  async findAllForClient(clientId: string, query: QueryReceivablesDto) {
    await this.ensureClientExists(clientId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const today = startOfToday();

    const statusWhere =
      query.status === 'paid'
        ? { status: ReceivableStatus.PAID }
        : query.status === 'pending'
          ? { status: ReceivableStatus.PENDING, dueDate: { gte: today } }
          : query.status === 'overdue'
            ? { status: ReceivableStatus.PENDING, dueDate: { lt: today } }
            : {};

    const where = { clientId, ...statusWhere };

    const [rows, total] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        orderBy: { dueDate: query.sort === 'dueDate_asc' ? 'asc' : 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.receivable.count({ where }),
    ]);

    return { items: rows.map(toResponse), total, page, pageSize };
  }

  async findOne(id: string) {
    const receivable = await this.assertExists(id);
    return toResponse(receivable);
  }

  async update(id: string, dto: UpdateReceivableDto) {
    await this.assertExists(id);
    const data: Record<string, unknown> = { ...dto };
    if (dto.dueDate) data.dueDate = parseDateOnly(dto.dueDate);
    const updated = await this.prisma.receivable.update({ where: { id }, data });
    return toResponse(updated);
  }

  async pay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.receivable.update({
      where: { id },
      data: { status: ReceivableStatus.PAID, paidAt: new Date() },
    });
    return toResponse(updated);
  }

  async unpay(id: string) {
    await this.assertExists(id);
    const updated = await this.prisma.receivable.update({
      where: { id },
      data: { status: ReceivableStatus.PENDING, paidAt: null },
    });
    return toResponse(updated);
  }

  async remove(id: string) {
    await this.assertExists(id);
    await this.prisma.receivable.delete({ where: { id } });
    return { id };
  }
}
