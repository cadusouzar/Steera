import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { CustomFieldValuesService } from '../custom-fields/custom-field-values.service';
import { PrismaService } from '../prisma/prisma.service';
import { ClientTrashService } from './client-trash.service';
import { ClientsService } from './clients.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: {
    client: Record<string, jest.Mock>;
    receivable: Record<string, jest.Mock>;
    subscription: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let clientTrash: { purgeExpiredTrash: jest.Mock };
  let customFieldValues: {
    resolveValuesForCreate: jest.Mock;
    setValues: jest.Mock;
    getValuesForRecords: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      client: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      receivable: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
      subscription: {
        updateMany: jest.fn(),
      },
      // Mirrors Prisma's interactive form: $transaction(async (tx) => ...) invokes the callback
      // with a `tx` — here the same mocked `prisma` object, so existing assertions against
      // `prisma.client.update`/`prisma.subscription.updateMany` keep working unchanged.
      $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };
    clientTrash = { purgeExpiredTrash: jest.fn().mockResolvedValue(0) };
    customFieldValues = {
      resolveValuesForCreate: jest.fn().mockResolvedValue({}),
      setValues: jest.fn(),
      getValuesForRecords: jest.fn().mockResolvedValue(new Map()),
    };

    const module = await Test.createTestingModule({
      providers: [
        ClientsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
        { provide: ClientTrashService, useValue: clientTrash },
        { provide: CustomFieldValuesService, useValue: customFieldValues },
      ],
    }).compile();

    service = module.get(ClientsService);
  });

  it('creates a client scoped to the current company', async () => {
    prisma.client.create.mockResolvedValue({ id: '1', name: 'Ana', companyId: 'company-1' });

    await service.create({ name: 'Ana', contact: 'x' } as any);

    expect(prisma.client.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Ana', contact: 'x', companyId: 'company-1' }),
    });
  });

  it('throws NotFoundException when client does not exist', async () => {
    prisma.client.findFirst.mockResolvedValue(null);
    await expect(service.findOne('missing-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.findFirst).toHaveBeenCalledWith({ where: { id: 'missing-id', companyId: 'company-1' } });
  });

  it('returns the client when found, with zeroed totals when it has no receivables', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findFirst.mockResolvedValue(client);
    await expect(service.findOne('1')).resolves.toEqual({
      ...client,
      totalPaid: 0,
      totalPending: 0,
      totalOverdue: 0,
      customFields: {},
    });
  });

  it('includes paid/pending/overdue totals scoped to the client', async () => {
    const client = { id: '1', name: 'Ana', status: 'ACTIVE' };
    prisma.client.findFirst.mockResolvedValue(client);
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
    prisma.client.findFirst.mockResolvedValue({ id: '1' });
    prisma.client.update.mockResolvedValue({ id: '1', name: 'Ana Nova' });

    const result = await service.update('1', { name: 'Ana Nova' });

    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { name: 'Ana Nova' },
    });
    expect(result).toEqual({ id: '1', name: 'Ana Nova', customFields: {} });
  });

  describe('findAll', () => {
    it('scopes the listing to the current company', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      prisma.client.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 20 } as any);

      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1' }) }),
      );
      expect(prisma.client.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1' }) }),
      );
    });

    it('filters by status when explicitly provided (e.g. status=ACTIVE for a strictly-active-only view)', async () => {
      prisma.client.findMany.mockResolvedValue([{ id: '1', status: 'ACTIVE' }]);
      prisma.client.count.mockResolvedValue(1);

      await service.findAll({ status: 'ACTIVE' as any, page: 1, pageSize: 20 });

      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1', status: 'ACTIVE' }) }),
      );
      expect(prisma.client.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1', status: 'ACTIVE' }) }),
      );
    });

    it('excludeTrashed excludes only status=INACTIVE+includeInRevenueReport=false — active AND inactive-but-kept clients both stay', async () => {
      prisma.client.findMany.mockResolvedValue([]);
      prisma.client.count.mockResolvedValue(0);

      await service.findAll({ excludeTrashed: true, page: 1, pageSize: 20 } as any);

      const expectedWhere = { companyId: 'company-1', NOT: { status: 'INACTIVE', includeInRevenueReport: false } };
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.client.count).toHaveBeenCalledWith({ where: expectedWhere });
    });
  });

  describe('deactivate', () => {
    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(
        service.deactivate('missing', { includeInRevenueReport: true }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the client is already inactive', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: '1', status: 'INACTIVE' });
      await expect(
        service.deactivate('1', { includeInRevenueReport: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deactivates the client and pauses its active subscriptions in one transaction, storing the chosen revenue flag', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: '1', status: 'ACTIVE' });
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
      prisma.client.findFirst.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: true });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      await service.deactivate('1', { includeInRevenueReport: true });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'INACTIVE', includeInRevenueReport: true, deactivatedAt: expect.any(Date) },
      });
    });

    it('records deactivatedAt as the current time', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false, deactivatedAt: new Date() });
      prisma.subscription.updateMany.mockResolvedValue({ count: 0 });

      const before = Date.now();
      await service.deactivate('1', { includeInRevenueReport: false });
      const after = Date.now();

      const passedAt: Date = (prisma.client.update as jest.Mock).mock.calls[0][0].data.deactivatedAt;
      expect(passedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(passedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('calls update/updateMany inside the same transaction callback, and rolls back if the second operation fails (atomicity)', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
      const tx = {
        client: { update: jest.fn().mockResolvedValue({ id: 'client-1', status: 'INACTIVE' }) },
        subscription: { updateMany: jest.fn().mockRejectedValue(new Error('falha simulada')) },
      };
      prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

      await expect(service.deactivate('client-1', { includeInRevenueReport: true })).rejects.toThrow(
        'falha simulada',
      );

      // Both operations were attempted INSIDE the same simulated transaction, in order — real
      // atomicity (a genuine rollback against Postgres) is covered by the e2e test; this unit
      // test only confirms the callback form is what's actually used (the regression this task
      // exists to prevent: silently going back to the array form).
      expect(tx.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: expect.objectContaining({ status: 'INACTIVE', includeInRevenueReport: true }),
      });
      expect(tx.subscription.updateMany).toHaveBeenCalledWith({
        where: { clientId: 'client-1', status: 'ACTIVE' },
        data: { status: 'INACTIVE' },
      });
    });
  });

  describe('restore', () => {
    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(service.restore('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when the client is already active', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      await expect(service.restore('1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it('reactivates the client and clears deactivatedAt, without touching includeInRevenueReport', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'ACTIVE', includeInRevenueReport: false, deactivatedAt: null });

      const result = await service.restore('1');

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'ACTIVE', deactivatedAt: null },
      });
      expect(result).toEqual({ id: '1', status: 'ACTIVE', includeInRevenueReport: false, deactivatedAt: null });
    });

    it('sets includeInRevenueReport when the caller decides it on restore (trash → back into reports)', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: '1', status: 'INACTIVE', includeInRevenueReport: false });
      prisma.client.update.mockResolvedValue({ id: '1', status: 'ACTIVE', includeInRevenueReport: true, deactivatedAt: null });

      await service.restore('1', { includeInRevenueReport: true });

      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: 'ACTIVE', deactivatedAt: null, includeInRevenueReport: true },
      });
    });
  });

  describe('findTrash', () => {
    it('purges expired entries first (via ClientTrashService), then returns only INACTIVE clients with includeInRevenueReport=false for the current company, oldest deactivation first', async () => {
      const trashed = [{ id: '1', status: 'INACTIVE', includeInRevenueReport: false, deactivatedAt: new Date('2026-09-01') }];
      prisma.client.findMany.mockResolvedValue(trashed);

      const result = await service.findTrash();

      expect(clientTrash.purgeExpiredTrash).toHaveBeenCalledTimes(1);
      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', status: 'INACTIVE', includeInRevenueReport: false },
        orderBy: { deactivatedAt: 'asc' },
      });
      expect(result).toEqual(trashed);
    });
  });
});
