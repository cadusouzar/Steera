import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: {
    client: Record<string, jest.Mock>;
    subscription: Record<string, jest.Mock>;
    receivable: Record<string, jest.Mock>;
  };

  beforeEach(async () => {
    prisma = {
      client: { findUnique: jest.fn() },
      subscription: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      receivable: { create: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [SubscriptionsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  it('throws NotFoundException when creating a subscription for a missing client', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing', { description: 'Plano', amount: 50, dueDay: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('generates a receivable charge from an active subscription, linked to it via subscriptionId + reference period', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      clientId: 'client-1',
      description: 'Mensalidade Escolar',
      amount: 850,
      dueDay: 5,
      status: SubscriptionStatus.ACTIVE,
    });
    prisma.receivable.create.mockResolvedValue({ id: 'rec-1' });

    await service.generateCharge('sub-1');

    expect(prisma.receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        subscriptionId: 'sub-1',
        referenceYear: expect.any(Number),
        referenceMonth: expect.any(Number),
        amount: 850,
        status: 'PENDING',
        description: expect.stringContaining('Mensalidade Escolar'),
      }),
    });
  });

  it('rejects generating a charge when the subscription\'s client is inactive', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      clientId: 'client-1',
      description: 'Mensalidade Escolar',
      amount: 850,
      dueDay: 5,
      status: SubscriptionStatus.ACTIVE,
    });
    prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'INACTIVE' });

    await expect(service.generateCharge('sub-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.receivable.create).not.toHaveBeenCalled();
  });

  it('rejects generating a second charge for the same subscription in the same month', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      clientId: 'client-1',
      description: 'Mensalidade Escolar',
      amount: 850,
      dueDay: 5,
      status: SubscriptionStatus.ACTIVE,
    });
    prisma.receivable.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`subscriptionId`,`referenceYear`,`referenceMonth`)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['subscriptionId', 'referenceYear', 'referenceMonth'] },
      }),
    );

    await expect(service.generateCharge('sub-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('re-throws non-unique-constraint database errors unchanged', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      clientId: 'client-1',
      description: 'Mensalidade Escolar',
      amount: 850,
      dueDay: 5,
      status: SubscriptionStatus.ACTIVE,
    });
    const dbError = new Error('connection lost');
    prisma.receivable.create.mockRejectedValue(dbError);

    await expect(service.generateCharge('sub-1')).rejects.toBe(dbError);
  });

  describe('generateCharge date handling', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('builds dueDate at UTC midnight and labels the charge with the CURRENT month, even when dueDay rolls over', async () => {
      // 2026-04-15, April has 30 days, so dueDay 31 rolls the due date into May.
      jest.useFakeTimers().setSystemTime(new Date('2026-04-15T12:00:00Z'));

      prisma.subscription.findUnique.mockResolvedValue({
        id: 'sub-1',
        clientId: 'client-1',
        description: 'Mensalidade Escolar',
        amount: 850,
        dueDay: 31,
        status: SubscriptionStatus.ACTIVE,
      });
      prisma.receivable.create.mockResolvedValue({ id: 'rec-1' });

      await service.generateCharge('sub-1');

      const data = prisma.receivable.create.mock.calls[0][0].data;
      const dueDate: Date = data.dueDate;

      // Rollover itself is intentional parity with the frontend: April 31 -> May 1.
      expect(dueDate.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      // ...but the label must still say April, matching the frontend's use of `now`.
      expect(data.description).toBe('Mensalidade Escolar (abril)');
    });
  });

  describe('generateDueCharges', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('queries only ACTIVE subscriptions whose dueDay has arrived, whose client is not inactive, and that have no charge for the current reference month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.generateDueCharges();

      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          dueDay: { lte: 15 },
          client: { status: { not: 'INACTIVE' } },
          receivables: { none: { referenceYear: 2026, referenceMonth: 6 } },
        },
      });
    });

    it.each([
      ['fevereiro (28 dias)', '2026-02-28T12:00:00Z', 2026, 2],
      ['fevereiro bissexto (29 dias)', '2028-02-29T12:00:00Z', 2028, 2],
      ['abril (30 dias)', '2026-04-30T12:00:00Z', 2026, 4],
    ])(
      'treats the last day of %s as day 31, so a dueDay of 29-31 is still selected that month',
      async (_label, systemTime, referenceYear, referenceMonth) => {
        jest.useFakeTimers().setSystemTime(new Date(systemTime));
        prisma.subscription.findMany.mockResolvedValue([]);

        await service.generateDueCharges();

        expect(prisma.subscription.findMany).toHaveBeenCalledWith({
          where: {
            status: 'ACTIVE',
            dueDay: { lte: 31 },
            client: { status: { not: 'INACTIVE' } },
            receivables: { none: { referenceYear, referenceMonth } },
          },
        });
      },
    );

    it('does NOT widen the dueDay filter before the last day of a short month', async () => {
      // 27 de fevereiro: ainda não é o último dia, então dueDay 28-31 continua de fora.
      jest.useFakeTimers().setSystemTime(new Date('2026-02-27T12:00:00Z'));
      prisma.subscription.findMany.mockResolvedValue([]);

      await service.generateDueCharges();

      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          dueDay: { lte: 27 },
          client: { status: { not: 'INACTIVE' } },
          receivables: { none: { referenceYear: 2026, referenceMonth: 2 } },
        },
      });
    });

    it('calls generateCharge for each subscription returned and counts how many succeeded', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.subscription.findUnique.mockResolvedValue({ id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' });
      prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
      prisma.receivable.create.mockResolvedValue({ id: 'rec-1' });

      const result = await service.generateDueCharges();

      expect(prisma.receivable.create).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ checked: 2, generated: 2 });
    });

    it('ignores a ConflictException from one subscription and still processes the rest', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' });
      prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
      prisma.receivable.create
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002', clientVersion: '5.22.0', meta: { target: ['subscriptionId', 'referenceYear', 'referenceMonth'] },
          }),
        )
        .mockResolvedValueOnce({ id: 'rec-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
    });

    it('silently skips a subscription whose client was deactivated between the query and the charge, without logging an error', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' });
      // client-1 foi desativado depois do findMany -> BadRequestException (corrida benigna).
      prisma.client.findUnique
        .mockResolvedValueOnce({ id: 'client-1', status: 'INACTIVE' })
        .mockResolvedValueOnce({ id: 'client-2', status: 'ACTIVE' });
      prisma.receivable.create.mockResolvedValue({ id: 'rec-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
      expect(prisma.receivable.create).toHaveBeenCalledTimes(1);
      expect(logError).not.toHaveBeenCalled();
      logError.mockRestore();
    });

    it('silently skips a subscription deleted between the query and the charge, without logging an error', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      // sub-1 sumiu entre o findMany e o generateCharge -> NotFoundException.
      prisma.subscription.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' });
      prisma.client.findUnique.mockResolvedValue({ id: 'client-2', status: 'ACTIVE' });
      prisma.receivable.create.mockResolvedValue({ id: 'rec-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
      expect(logError).not.toHaveBeenCalled();
      logError.mockRestore();
    });

    it('logs but does not throw when a non-conflict error occurs, and still processes the remaining subscriptions', async () => {
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
        { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.subscription.findUnique
        .mockResolvedValueOnce({ id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' });
      prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'ACTIVE' });
      prisma.receivable.create
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ id: 'rec-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
      // Erro genuinamente inesperado: este SIM tem que aparecer no log.
      expect(logError).toHaveBeenCalledTimes(1);
      logError.mockRestore();
    });
  });
});
