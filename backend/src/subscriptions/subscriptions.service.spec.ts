import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
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
      client: { findFirst: jest.fn(), findUnique: jest.fn() },
      subscription: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      receivable: { create: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();

    service = module.get(SubscriptionsService);
  });

  it('throws NotFoundException when creating a subscription for a missing client', async () => {
    prisma.client.findFirst.mockResolvedValue(null);
    await expect(
      service.create('missing', { description: 'Plano', amount: 50, dueDay: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.client.findFirst).toHaveBeenCalledWith({ where: { id: 'missing', companyId: 'company-1' } });
  });

  it('scopes the lookup to the current company, so a subscription from another company 404s', async () => {
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.findOne('sub-other-company')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { id: 'sub-other-company', client: { companyId: 'company-1' } },
    });
  });

  it('generates a receivable charge from an active subscription, linked to it via subscriptionId + reference period', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
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
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'sub-1',
      clientId: 'client-1',
      description: 'Mensalidade Escolar',
      amount: 850,
      dueDay: 5,
      status: SubscriptionStatus.ACTIVE,
    });
    // generateCharge does a plain findUnique-by-id lookup for the client's
    // active/inactive status once the subscription's own company scope has
    // already been verified by assertExists.
    prisma.client.findUnique.mockResolvedValue({ id: 'client-1', status: 'INACTIVE' });

    await expect(service.generateCharge('sub-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.receivable.create).not.toHaveBeenCalled();
  });

  it('rejects generating a second charge for the same subscription in the same month', async () => {
    prisma.subscription.findFirst.mockResolvedValue({
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
    prisma.subscription.findFirst.mockResolvedValue({
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

      prisma.subscription.findFirst.mockResolvedValue({
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
});
