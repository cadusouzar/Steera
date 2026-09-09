import { Injectable, NotFoundException } from '@nestjs/common';
import { Receivable, ReceivableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { QueryReceivablesDto } from './dto/query-receivables.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';

export type DerivedReceivableStatus = 'pending' | 'paid' | 'overdue';

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
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
  }

  private async assertExists(id: string) {
    const found = await this.prisma.receivable.findUnique({ where: { id } });
    if (!found) throw new NotFoundException(`Lançamento ${id} não encontrado`);
  }

  async create(clientId: string, dto: CreateReceivableDto) {
    await this.ensureClientExists(clientId);
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
        orderBy: { dueDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.receivable.count({ where }),
    ]);

    return { items: rows.map(toResponse), total, page, pageSize };
  }

  async findOne(id: string) {
    const receivable = await this.prisma.receivable.findUnique({ where: { id } });
    if (!receivable) throw new NotFoundException(`Lançamento ${id} não encontrado`);
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
