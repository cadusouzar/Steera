import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionsBillingService } from './subscriptions-billing.service';

describe('SubscriptionsBillingService', () => {
  let service: SubscriptionsBillingService;
  let prisma: { subscription: Record<string, jest.Mock>; receivable: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      subscription: { findMany: jest.fn() },
      receivable: { create: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [SubscriptionsBillingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(SubscriptionsBillingService);
  });

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

  it('generates a charge for a subscription with no receivable this month', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
    ]);
    prisma.receivable.create.mockResolvedValue({ id: 'rec-1' });

    const result = await service.generateDueCharges();

    expect(prisma.receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        subscriptionId: 'sub-1',
        amount: 100,
        status: 'PENDING',
      }),
    });
    expect(result).toEqual({ checked: 1, generated: 1 });
  });

  it('ignores (does not log as an error) a P2002 collision', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma.subscription.findMany.mockResolvedValue([
      { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
    ]);
    prisma.receivable.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['subscriptionId', 'referenceYear', 'referenceMonth'] },
      }),
    );

    const result = await service.generateDueCharges();

    expect(result).toEqual({ checked: 1, generated: 0 });
    expect(logError).not.toHaveBeenCalled();
    logError.mockRestore();
  });

  it('logs an error for any other failure and still counts checked/generated correctly', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma.subscription.findMany.mockResolvedValue([
      { id: 'sub-1', clientId: 'client-1', description: 'Plano A', amount: 100, dueDay: 5, status: 'ACTIVE' },
      { id: 'sub-2', clientId: 'client-2', description: 'Plano B', amount: 200, dueDay: 5, status: 'ACTIVE' },
    ]);
    prisma.receivable.create
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ id: 'rec-2' });

    const result = await service.generateDueCharges();

    expect(result).toEqual({ checked: 2, generated: 1 });
    expect(logError).toHaveBeenCalledTimes(1);
    logError.mockRestore();
  });
});
