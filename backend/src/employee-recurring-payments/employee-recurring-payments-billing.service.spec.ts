import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeRecurringPaymentsBillingService } from './employee-recurring-payments-billing.service';

describe('EmployeeRecurringPaymentsBillingService', () => {
  let service: EmployeeRecurringPaymentsBillingService;
  let prisma: { employeeRecurringPayment: Record<string, jest.Mock>; employeePayment: Record<string, jest.Mock> };

  beforeEach(async () => {
    prisma = {
      employeeRecurringPayment: { findMany: jest.fn() },
      employeePayment: { create: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [EmployeeRecurringPaymentsBillingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(EmployeeRecurringPaymentsBillingService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries only ACTIVE recurring payments whose dueDay has arrived, whose employee is not inactive with salaryRecurrenceEnabled, and that have no payment for the current reference month', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
    prisma.employeeRecurringPayment.findMany.mockResolvedValue([]);

    await service.generateDueCharges();

    expect(prisma.employeeRecurringPayment.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        dueDay: { lte: 15 },
        employee: { status: { not: 'INACTIVE' }, salaryRecurrenceEnabled: true },
        payments: { none: { referenceYear: 2026, referenceMonth: 6 } },
      },
    });
  });

  it('generates a payment for a recurring payment with no charge this month', async () => {
    prisma.employeeRecurringPayment.findMany.mockResolvedValue([
      { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
    ]);
    prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1' });

    const result = await service.generateDueCharges();

    expect(prisma.employeePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-1',
        employeeId: 'employee-1',
        recurringPaymentId: 'rec-1',
        amount: 5000,
        status: 'PENDING',
      }),
    });
    expect(result).toEqual({ checked: 1, generated: 1 });
  });

  it('ignores (does not log as an error) a P2002 collision', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma.employeeRecurringPayment.findMany.mockResolvedValue([
      { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
    ]);
    prisma.employeePayment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['recurringPaymentId', 'referenceYear', 'referenceMonth'] },
      }),
    );

    const result = await service.generateDueCharges();

    expect(result).toEqual({ checked: 1, generated: 0 });
    expect(logError).not.toHaveBeenCalled();
    logError.mockRestore();
  });

  it('logs an error for any other failure and still counts checked/generated correctly', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    prisma.employeeRecurringPayment.findMany.mockResolvedValue([
      { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
      { id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' },
    ]);
    prisma.employeePayment.create
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ id: 'payment-2' });

    const result = await service.generateDueCharges();

    expect(result).toEqual({ checked: 2, generated: 1 });
    expect(logError).toHaveBeenCalledTimes(1);
    logError.mockRestore();
  });
});
