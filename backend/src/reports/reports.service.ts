import { Injectable } from '@nestjs/common';
import { Prisma, ReceivableStatus, SubscriptionStatus } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { localDateOnly, startOfToday } from '../common/date.util';
import type { ReportPeriod } from './report-period.util';

export interface Defaulter {
  clientId: string;
  name: string;
  category: string | null;
  contact: string;
  overdueAmount: number;
}

export interface ReceiptItem {
  id: string;
  clientId: string;
  clientName: string;
  description: string;
  dueDate: string;
  paidAt: string;
  amount: number;
}

// Teto da lista de recebimentos do período — os totais nunca são truncados, só a lista.
const RECEIPTS_LIMIT = 1000;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
  ) {}

  async financialSummary(topDefaulters = 5, period?: ReportPeriod) {
    const companyId = await this.companyContext.getCurrentCompanyId();
    // Independent of Client.status on purpose (a deactivated client can still
    // be counted here) — see includeInRevenueReport on the Client model.
    const revenueClientFilter = { client: { companyId, includeInRevenueReport: true } };

    // Sem período: comportamento de sempre (hoje = dia UTC). Com período (06/10/2026): hoje e os
    // dias do período seguem o fuso da empresa — Company é tabela central, lida fora de transação.
    let today = startOfToday();
    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (period) {
      const { timezone } = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
      today = localDateOnly(new Date(), timezone);
      fromDate = localDateOnly(period.from, timezone);
      toDate = localDateOnly(period.to, timezone);
    }

    const paidWhere: Prisma.ReceivableWhereInput = {
      status: ReceivableStatus.PAID,
      ...revenueClientFilter,
      ...(period ? { paidAt: { gte: period.from, lte: period.to } } : {}),
    };
    const pendingDueDate: Prisma.DateTimeFilter = period && fromDate && toDate
      ? { gte: fromDate > today ? fromDate : today, lte: toDate }
      : { gte: today };

    const [paidAgg, pendingAgg, overdueRows, recurringAgg, periodOverdueAgg, receiptRows] = await Promise.all([
      this.prisma.receivable.aggregate({ _sum: { amount: true }, where: paidWhere }),
      this.prisma.receivable.aggregate({
        _sum: { amount: true },
        where: { status: ReceivableStatus.PENDING, dueDate: pendingDueDate, ...revenueClientFilter },
      }),
      // Maiores atrasos: sempre o retrato atual, com ou sem período.
      this.prisma.receivable.findMany({
        where: { status: ReceivableStatus.PENDING, dueDate: { lt: today }, ...revenueClientFilter },
        select: {
          amount: true,
          client: { select: { id: true, name: true, category: true, contact: true } },
        },
      }),
      this.prisma.subscription.aggregate({
        _sum: { amount: true },
        where: { status: SubscriptionStatus.ACTIVE, ...revenueClientFilter },
      }),
      period && fromDate && toDate
        ? this.prisma.receivable.aggregate({
            _sum: { amount: true },
            where: {
              status: ReceivableStatus.PENDING,
              dueDate: { gte: fromDate, lte: toDate, lt: today },
              ...revenueClientFilter,
            },
          })
        : Promise.resolve(null),
      period
        ? this.prisma.receivable.findMany({
            where: paidWhere,
            orderBy: { paidAt: 'asc' },
            take: RECEIPTS_LIMIT + 1,
            select: {
              id: true,
              description: true,
              amount: true,
              dueDate: true,
              paidAt: true,
              client: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const overdueByClient = new Map<string, Defaulter>();
    let totalOverdueNow = 0;

    for (const row of overdueRows) {
      const amount = Number(row.amount);
      totalOverdueNow += amount;
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

    const receipts: ReceiptItem[] = receiptRows.slice(0, RECEIPTS_LIMIT).map((r) => ({
      id: r.id,
      clientId: r.client.id,
      clientName: r.client.name,
      description: r.description,
      dueDate: r.dueDate.toISOString().slice(0, 10),
      paidAt: (r.paidAt as Date).toISOString(),
      amount: Number(r.amount),
    }));

    return {
      totalPaid: Number(paidAgg._sum.amount ?? 0),
      totalPending: Number(pendingAgg._sum.amount ?? 0),
      totalOverdue: periodOverdueAgg ? Number(periodOverdueAgg._sum.amount ?? 0) : totalOverdueNow,
      totalRecurring: Number(recurringAgg._sum.amount ?? 0),
      topDefaulters: rankedDefaulters,
      period: period ? { from: period.from.toISOString(), to: period.to.toISOString() } : null,
      receipts,
      receiptsTruncated: receiptRows.length > RECEIPTS_LIMIT,
    };
  }
}
