import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: { receivable: Record<string, jest.Mock>; subscription: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      receivable: { aggregate: jest.fn(), findMany: jest.fn() },
      subscription: { aggregate: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ReportsService);
  });

  it('aggregates totals and ranks defaulters by overdue amount, limited to topDefaulters', async () => {
    prisma.receivable.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // paid
      .mockResolvedValueOnce({ _sum: { amount: 200 } }); // pending
    prisma.receivable.findMany.mockResolvedValue([
      { amount: 300, client: { id: 'c1', name: 'Cliente 1', category: null, contact: 'x' } },
      { amount: 700, client: { id: 'c2', name: 'Cliente 2', category: null, contact: 'y' } },
      { amount: 100, client: { id: 'c1', name: 'Cliente 1', category: null, contact: 'x' } },
    ]);
    prisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 99.9 } });

    const result = await service.financialSummary(1);

    expect(result.totalPaid).toBe(1000);
    expect(result.totalPending).toBe(200);
    expect(result.totalOverdue).toBe(1100);
    expect(result.totalRecurring).toBe(99.9);
    expect(result.topDefaulters).toEqual([
      { clientId: 'c2', name: 'Cliente 2', category: null, contact: 'y', overdueAmount: 700 },
    ]);
  });

  it('uses a UTC-midnight boundary for the pending/overdue split', async () => {
    prisma.receivable.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 } })
      .mockResolvedValueOnce({ _sum: { amount: 0 } });
    prisma.receivable.findMany.mockResolvedValue([]);
    prisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    await service.financialSummary();

    // Prisma reads `dueDate` (@db.Date) back as UTC midnight, so the boundary
    // compared against it must be UTC midnight too — not local midnight.
    const pendingBoundary: Date = prisma.receivable.aggregate.mock.calls[1][0].where.dueDate.gte;
    const overdueBoundary: Date = prisma.receivable.findMany.mock.calls[0][0].where.dueDate.lt;

    for (const boundary of [pendingBoundary, overdueBoundary]) {
      expect(boundary.getUTCHours()).toBe(0);
      expect(boundary.getUTCMinutes()).toBe(0);
      expect(boundary.getUTCSeconds()).toBe(0);
      expect(boundary.getUTCMilliseconds()).toBe(0);
    }
    expect(pendingBoundary.getTime()).toBe(overdueBoundary.getTime());
  });
});
