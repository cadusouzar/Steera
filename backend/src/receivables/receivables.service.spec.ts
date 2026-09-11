import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  it('treats a receivable due today as pending, not overdue (regression: UTC-midnight @db.Date)', () => {
    // Prisma reads a `@db.Date` column back as UTC midnight, never local midnight.
    // A PENDING receivable due exactly today must therefore derive to 'pending'
    // in any local timezone offset. Built from UTC getters (not local) to
    // genuinely match the UTC calendar day, independent of the machine's
    // timezone — startOfToday() itself must do the same (see common/date.util.ts).
    const now = new Date();
    const utcMidnightToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const result = deriveReceivableStatus({
      status: ReceivableStatus.PENDING,
      dueDate: utcMidnightToday,
    });
    expect(result).toBe('pending');
  });

  it('treats a receivable due yesterday as overdue (UTC-midnight @db.Date)', () => {
    const now = new Date();
    const utcMidnightYesterday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    );
    const result = deriveReceivableStatus({
      status: ReceivableStatus.PENDING,
      dueDate: utcMidnightYesterday,
    });
    expect(result).toBe('overdue');
  });

  it('treats a receivable due tomorrow as pending (UTC-midnight @db.Date)', () => {
    const now = new Date();
    const utcMidnightTomorrow = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const result = deriveReceivableStatus({
      status: ReceivableStatus.PENDING,
      dueDate: utcMidnightTomorrow,
    });
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

  it('rejects creating a receivable for an inactive client', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'client1', status: 'INACTIVE' });
    await expect(
      service.create('client1', { description: 'x', amount: 10, dueDate: '2026-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it('stores a "YYYY-MM-DD" dueDate as UTC midnight, matching how Prisma reads @db.Date back', async () => {
    prisma.client.findUnique.mockResolvedValue({ id: 'client1' });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    // Build the string from UTC calendar-day components — matching what
    // startOfToday() itself now correctly computes (see common/date.util.ts).
    const todayStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    const expectedUtcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    prisma.receivable.create.mockImplementation(({ data }: any) => ({
      id: '1',
      clientId: 'client1',
      description: data.description,
      amount: data.amount,
      dueDate: data.dueDate,
      status: ReceivableStatus.PENDING,
      paidAt: null,
    }));

    const created = await service.create('client1', {
      description: 'today receivable',
      amount: 100,
      dueDate: todayStr,
    });

    const passedDate = prisma.receivable.create.mock.calls[0][0].data.dueDate as Date;
    expect(passedDate.toISOString()).toBe(expectedUtcMidnight.toISOString());
    expect(passedDate.getUTCHours()).toBe(0);
    // Regression: a receivable created for *today* must never come back as overdue.
    expect(created.derivedStatus).toBe('pending');
  });
});
