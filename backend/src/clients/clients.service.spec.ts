import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: {
    client: Record<string, jest.Mock>;
    receivable: Record<string, jest.Mock>;
    subscription: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      client: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      receivable: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
      subscription: {
        updateMany: jest.fn(),
      },
      // Mirrors Prisma's array form: $transaction([opA, opB]) resolves each
      // operation (already a promise from the mocked calls above) in order.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module = await Test.createTestingModule({
      providers: [ClientsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ClientsService);
  });

  it('throws NotFoundException when client does not exist', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the client when found, with zeroed totals when it has no receivables', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findUnique.mockResolvedValue(client);
    await expect(service.findOne('1')).resolves.toEqual({
      ...client,
      totalPaid: 0,
      totalPending: 0,
      totalOverdue: 0,
    });
  });

  it('includes paid/pending/overdue totals scoped to the client', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findUnique.mockResolvedValue(client);
    prisma.receivable.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // paid
      .mockResolvedValueOnce({ _sum: { amount: 250.5 } }) // pending
      .mockResolvedValueOnce({ _sum: { amount: 80 } }); // overdue

    const result = await service.findOne('1');

    expect(result.totalPaid).toBe(1000);
    expect(result.totalPending).toBe(250.5);
    expect(result.totalOverdue).toBe(80);

    // Every aggregate must be scoped to this client, and the pending/overdue
    // boundary must be UTC midnight (Prisma reads @db.Date back as UTC midnight).
    const wheres = prisma.receivable.aggregate.mock.calls.map((call) => call[0].where);
    expect(wheres.every((where) => where.clientId === '1')).toBe(true);
    for (const where of wheres.slice(1)) {
      const boundary: Date = where.dueDate.gte ?? where.dueDate.lt;
      expect(boundary.getUTCHours()).toBe(0);
      expect(boundary.getUTCMinutes()).toBe(0);
      expect(boundary.getUTCSeconds()).toBe(0);
      expect(boundary.getUTCMilliseconds()).toBe(0);
    }
  });

  it('updates only after confirming the client exists', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: '1' });
    prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE' });

    const result = await service.update('1', { status: 'INACTIVE' as any });

    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: 'INACTIVE' },
    });
    expect(result).toEqual({ id: '1', status: 'INACTIVE' });
  });

  describe('findAll', () => {
    it('filters by status when provided, for the "listagem padrão" (active-only) use case', async () => {
      prisma.client.findMany.mockResolvedValue([{ id: '1', status: 'ACTIVE' }]);
      prisma.client.count.mockResolvedValue(1);

      await service.findAll({ status: 'ACTIVE' as any, page: 1, pageSize: 20 });

      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
      );
      expect(prisma.client.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
      );
    });
  });

  describe('deactivate', () => {
    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(
        service.deactivate('missing', { includeInRevenueReport: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the client is already inactive', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'INACTIVE' });
      await expect(
        service.deactivate('1', { includeInRevenueReport: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deactivates the client and pauses its active subscriptions in one transaction, storing the chosen revenue flag', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false });
      prisma.subscription.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.deactivate('1', { includeInRevenueReport: false });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'INACTIVE', includeInRevenueReport: false, deactivatedAt: expect.any(Date) },
      });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { clientId: '1', status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
      expect(result).toEqual({ id: '1', status: 'INACTIVE', includeInRevenueReport: false });
    });

    it('preserves includeInRevenueReport=true when that is the chosen option', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: true });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await service.deactivate('1', { includeInRevenueReport: true });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'INACTIVE', includeInRevenueReport: true, deactivatedAt: expect.any(Date) },
      });
    });

    it('records deactivatedAt as the current time', async () => {
      prisma.client.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false, deactivatedAt: new Date() });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await service.deactivate('1', { includeInRevenueReport: false });
      const after = Date.now();

      const passedAt: Date = (prisma.client.update as jest.Mock).mock.calls[0][0].data.deactivatedAt;
      expect(passedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(passedAt.getTime()).toBeLessThanOrEqual(after);
    });
  });
});
