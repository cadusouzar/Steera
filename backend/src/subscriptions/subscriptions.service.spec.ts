import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SubscriptionStatus } from '@prisma/client';
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

  it('generates a receivable charge from an active subscription', async () => {
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
        amount: 850,
        status: 'PENDING',
        description: expect.stringContaining('Mensalidade Escolar'),
      }),
    });
  });
});
