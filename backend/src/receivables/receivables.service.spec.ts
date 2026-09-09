import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReceivableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveReceivableStatus, ReceivablesService } from './receivables.service';

describe('deriveReceivableStatus', () => {
  it('returns paid when status is PAID regardless of due date', () => {
    const result = deriveReceivableStatus({ status: ReceivableStatus.PAID, dueDate: new Date('2000-01-01') });
    expect(result).toBe('paid');
  });

  it('returns overdue when pending and due date is in the past', () => {
    const result = deriveReceivableStatus({ status: ReceivableStatus.PENDING, dueDate: new Date('2000-01-01') });
    expect(result).toBe('overdue');
  });

  it('returns pending when pending and due date is in the future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const result = deriveReceivableStatus({ status: ReceivableStatus.PENDING, dueDate: future });
    expect(result).toBe('pending');
  });

  it('correctly handles a date exactly at local midnight today (timezone safety)', () => {
    // A date at local midnight today should be classified as 'pending', not 'overdue'
    const today = new Date();
    const localMidnightToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const result = deriveReceivableStatus({ status: ReceivableStatus.PENDING, dueDate: localMidnightToday });
    expect(result).toBe('pending');
  });
});

describe('ReceivablesService', () => {
  let service: ReceivablesService;
  let prisma: { client: Record<string, jest.Mock>; receivable: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      client: { findUnique: jest.fn() },
      receivable: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [ReceivablesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ReceivablesService);
  });

  it('throws NotFoundException when creating a receivable for a missing client', async () => {
    prisma.client.findUnique.mockResolvedValue(null);
    await expect(
      service.create('missing', { description: 'x', amount: 10, dueDate: '2026-01-01' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.receivable.create).not.toHaveBeenCalled();
  });

  it('marks a receivable as paid and sets paidAt', async () => {
    prisma.receivable.findUnique.mockResolvedValue({ id: '1' });
    prisma.receivable.update.mockResolvedValue({
      id: '1',
      status: ReceivableStatus.PAID,
      dueDate: new Date('2020-01-01'),
      paidAt: new Date(),
    });

    const result = await service.pay('1');

    expect(prisma.receivable.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: ReceivableStatus.PAID, paidAt: expect.any(Date) },
    });
    expect(result.derivedStatus).toBe('paid');
  });

  it('reverts payment on unpay', async () => {
    prisma.receivable.findUnique.mockResolvedValue({ id: '1' });
    prisma.receivable.update.mockResolvedValue({
      id: '1',
      status: ReceivableStatus.PENDING,
      dueDate: new Date('2999-01-01'),
      paidAt: null,
    });

    const result = await service.unpay('1');

    expect(prisma.receivable.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { status: ReceivableStatus.PENDING, paidAt: null },
    });
    expect(result.derivedStatus).toBe('pending');
  });

  it('parses date strings as local midnight, not UTC (timezone safety)', async () => {
    // When creating a receivable with today's date as "YYYY-MM-DD", it should parse
    // as local midnight (matching startOfToday()), not UTC midnight
    prisma.client.findUnique.mockResolvedValue({ id: 'client1' });

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // e.g., "2026-09-09"
    const expectedLocalMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    prisma.receivable.create.mockResolvedValue({
      id: '1',
      description: 'today receivable',
      amount: 100,
      dueDate: expectedLocalMidnight,
      status: ReceivableStatus.PENDING,
      clientId: 'client1',
      paidAt: null,
    });

    await service.create('client1', { description: 'today receivable', amount: 100, dueDate: todayStr });

    // Verify that create was called with a date at local midnight (not UTC midnight)
    expect(prisma.receivable.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        dueDate: expect.any(Date),
      }),
    });
    const callArgs = prisma.receivable.create.mock.calls[0][0];
    const passedDate = callArgs.data.dueDate as Date;
    expect(passedDate.getHours()).toBe(0);
    expect(passedDate.getMinutes()).toBe(0);
    expect(passedDate.getSeconds()).toBe(0);
  });
});
