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
});
