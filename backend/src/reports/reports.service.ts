import { Injectable } from '@nestjs/common';
import { ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { startOfToday } from '../common/date.util';

export interface Defaulter {
  clientId: string;
  name: string;
  category: string | null;
  contact: string;
  overdueAmount: number;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async financialSummary(topDefaulters = 5) {
    const today = startOfToday();

    const [paidAgg, pendingAgg, overdueRows, recurringAgg] = await Promise.all([
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { status: ReceivableStatus.PAID },
      }),
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { status: ReceivableStatus.PENDING, dueDate: { gte: today } },
      }),
      this.prisma.receivable.findMany({
        where: { status: ReceivableStatus.PENDING, dueDate: { lt: today } },
        select: {
          amount: true,
          client: { select: { id: true, name: true, category: true, contact: true } },
        },
      }),
      this.prisma.subscription.aggregate({
        _sum: { amount: true },
        where: { status: SubscriptionStatus.ACTIVE },
      }),
    ]);

    const overdueByClient = new Map<string, Defaulter>();
    let totalOverdue = 0;

    for (const row of overdueRows) {
      const amount = Number(row.amount);
      totalOverdue += amount;
      const existing = overdueByClient.get(row.client.id);
      if (existing) {
        existing.overdueAmount += amount;
      } else {
        overdueByClient.set(row.client.id, {
          clientId: row.client.id,
          name: row.client.name,
          category: row.client.category,
          contact: row.client.contact,
          overdueAmount: amount,
        });
      }
    }

    const rankedDefaulters = Array.from(overdueByClient.values())
      .sort((a, b) => b.overdueAmount - a.overdueAmount)
      .slice(0, topDefaulters);

    return {
      totalPaid: Number(paidAgg._sum.amount ?? 0),
      totalPending: Number(pendingAgg._sum.amount ?? 0),
      totalOverdue,
      totalRecurring: Number(recurringAgg._sum.amount ?? 0),
      topDefaulters: rankedDefaulters,
    };
  }
}
