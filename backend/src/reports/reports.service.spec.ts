import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: Record<string, Record<string, jest.Mock>>;

  beforeEach(async () => {
    prisma = {
      receivable: { aggregate: jest.fn(), findMany: jest.fn() },
      subscription: { aggregate: jest.fn() },
      company: { findUniqueOrThrow: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
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

  it('only counts clients with includeInRevenueReport = true, in every one of the four aggregates', async () => {
    prisma.receivable.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 500 } }) // paid
      .mockResolvedValueOnce({ _sum: { amount: 100 } }); // pending
    prisma.receivable.findMany.mockResolvedValue([]);
    prisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 50 } });

    await service.financialSummary();

    const [paidCall, pendingCall] = prisma.receivable.aggregate.mock.calls;
    // Deliberately NOT filtered by client.status — an inactive client with the
    // flag on must still count (rule: don't confuse active/inactive with the
    // revenue-report flag). Scoped to the current company in every one of the
    // four aggregates too.
    expect(paidCall[0].where.client).toEqual({ companyId: 'company-1', includeInRevenueReport: true });
    expect(pendingCall[0].where.client).toEqual({ companyId: 'company-1', includeInRevenueReport: true });
    expect(prisma.receivable.findMany.mock.calls[0][0].where.client).toEqual({ companyId: 'company-1', includeInRevenueReport: true });
    expect(prisma.subscription.aggregate.mock.calls[0][0].where.client).toEqual({ companyId: 'company-1', includeInRevenueReport: true });
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

  it('sem período: lista de recebimentos vazia, period null, e não lê o fuso da empresa', async () => {
    prisma.receivable.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    prisma.receivable.findMany.mockResolvedValue([]);
    prisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

    const result = await service.financialSummary();

    expect(result.period).toBeNull();
    expect(result.receipts).toEqual([]);
    expect(result.receiptsTruncated).toBe(false);
    expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.receivable.aggregate).toHaveBeenCalledTimes(2);
  });

  describe('com período', () => {
    // 05/10 08:00 → 06/10 01:00 no horário de São Paulo (UTC-3)
    const period = { from: new Date('2026-10-05T11:00:00.000Z'), to: new Date('2026-10-06T04:00:59.999Z') };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-06T04:30:00.000Z')); // 06/10 01:30 em SP
      prisma.company.findUniqueOrThrow.mockResolvedValue({ timezone: 'America/Sao_Paulo' });
      prisma.subscription.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    });
    afterEach(() => jest.useRealTimers());

    it('Recebido filtra paidAt pelo instante exato; vencimentos pelos dias 05 e 06 no fuso da empresa', async () => {
      prisma.receivable.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 300 } }) // paid
        .mockResolvedValueOnce({ _sum: { amount: 40 } }) // pending
        .mockResolvedValueOnce({ _sum: { amount: 15 } }); // overdue no período
      prisma.receivable.findMany
        .mockResolvedValueOnce([]) // atrasos atuais (maiores atrasos)
        .mockResolvedValueOnce([]); // recebimentos

      const result = await service.financialSummary(5, period);

      const [paidCall, pendingCall, overdueCall] = prisma.receivable.aggregate.mock.calls;
      expect(paidCall[0].where.paidAt).toEqual({ gte: period.from, lte: period.to });
      // hoje na empresa = 06/10, então "a receber" é só o dia 06
      expect(pendingCall[0].where.dueDate).toEqual({
        gte: new Date('2026-10-06T00:00:00.000Z'),
        lte: new Date('2026-10-06T00:00:00.000Z'),
      });
      expect(overdueCall[0].where.dueDate).toEqual({
        gte: new Date('2026-10-05T00:00:00.000Z'),
        lte: new Date('2026-10-06T00:00:00.000Z'),
        lt: new Date('2026-10-06T00:00:00.000Z'),
      });
      expect(overdueCall[0].where.status).toBe('PENDING');
      expect(result.totalPaid).toBe(300);
      expect(result.totalPending).toBe(40);
      expect(result.totalOverdue).toBe(15);
      expect(result.period).toEqual({ from: period.from.toISOString(), to: period.to.toISOString() });
    });

    it('maiores atrasos continuam sendo o retrato atual (sem filtro de período)', async () => {
      prisma.receivable.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      prisma.receivable.findMany
        .mockResolvedValueOnce([{ amount: 500, client: { id: 'c1', name: 'Antigo', category: null, contact: 'x' } }])
        .mockResolvedValueOnce([]);

      const result = await service.financialSummary(5, period);

      const defaultersCall = prisma.receivable.findMany.mock.calls[0][0];
      expect(defaultersCall.where.dueDate).toEqual({ lt: new Date('2026-10-06T00:00:00.000Z') });
      expect(result.topDefaulters).toEqual([
        { clientId: 'c1', name: 'Antigo', category: null, contact: 'x', overdueAmount: 500 },
      ]);
      expect(result.totalOverdue).toBe(0); // o total do período vem do agregado, não dos atrasos atuais
    });

    it('lista os recebimentos do período em ordem de pagamento e marca quando passa de 1000', async () => {
      prisma.receivable.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      const row = {
        id: 'r1',
        description: 'Mensalidade',
        amount: 99.5,
        dueDate: new Date('2026-10-05T00:00:00.000Z'),
        paidAt: new Date('2026-10-06T03:30:00.000Z'),
        client: { id: 'c1', name: 'Cliente 1' },
      };
      prisma.receivable.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(Array.from({ length: 1001 }, (_, i) => ({ ...row, id: `r${i}` })));

      const result = await service.financialSummary(5, period);

      const receiptsCall = prisma.receivable.findMany.mock.calls[1][0];
      expect(receiptsCall.where.paidAt).toEqual({ gte: period.from, lte: period.to });
      expect(receiptsCall.where.status).toBe('PAID');
      expect(receiptsCall.where.client).toEqual({ companyId: 'company-1', includeInRevenueReport: true });
      expect(receiptsCall.orderBy).toEqual({ paidAt: 'asc' });
      expect(receiptsCall.take).toBe(1001);
      expect(result.receipts).toHaveLength(1000);
      expect(result.receiptsTruncated).toBe(true);
      expect(result.receipts[0]).toEqual({
        id: 'r0',
        clientId: 'c1',
        clientName: 'Cliente 1',
        description: 'Mensalidade',
        dueDate: '2026-10-05',
        paidAt: '2026-10-06T03:30:00.000Z',
        amount: 99.5,
      });
    });
  });
});
