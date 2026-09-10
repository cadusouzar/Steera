import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeRecurringPaymentsService } from './employee-recurring-payments.service';

describe('EmployeeRecurringPaymentsService', () => {
  let service: EmployeeRecurringPaymentsService;
  let prisma: { employeeRecurringPayment: Record<string, jest.Mock>; employeePayment: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      employeeRecurringPayment: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
      employeePayment: { create: jest.fn() },
    };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        EmployeeRecurringPaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(EmployeeRecurringPaymentsService);
  });

  it('rejects creating a recurring payment for an inactive employee', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'INACTIVE' });

    await expect(
      service.create('employee-1', { description: 'Salário', amount: 5000, dueDay: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.employeeRecurringPayment.create).not.toHaveBeenCalled();
  });

  it('filters nested recurring-payment listings by companyId too, not just employeeId', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.employeeRecurringPayment.findMany.mockResolvedValue([]);

    await service.findAllForEmployee('employee-1');

    expect(prisma.employeeRecurringPayment.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1', companyId: 'company-1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('rejects generating a charge when the employee is inactive', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
      id: 'rec-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
    });
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'INACTIVE' });

    await expect(service.generateCharge('rec-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.employeePayment.create).not.toHaveBeenCalled();
  });

  it('generates a payment linked to the recurring payment via recurringPaymentId + reference period', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
      id: 'rec-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
    });
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1' });

    await service.generateCharge('rec-1');

    expect(prisma.employeePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'employee-1', recurringPaymentId: 'rec-1',
        referenceYear: expect.any(Number), referenceMonth: expect.any(Number),
        amount: 5000, status: 'PENDING',
      }),
    });
  });

  it('rejects a second charge for the same recurring payment in the same month (unique constraint translated to 409)', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
      id: 'rec-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
    });
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    prisma.employeePayment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002', clientVersion: '5.22.0', meta: { target: ['recurringPaymentId', 'referenceYear', 'referenceMonth'] },
      }),
    );

    await expect(service.generateCharge('rec-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('scopes the lookup to the current company, so a recurring payment from another company 404s', async () => {
    prisma.employeeRecurringPayment.findFirst.mockResolvedValue(null);
    await expect(service.findOne('rec-other-company')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.employeeRecurringPayment.findFirst).toHaveBeenCalledWith({
      where: { id: 'rec-other-company', companyId: 'company-1' },
    });
  });

  describe('generateDueCharges', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('queries only ACTIVE recurring payments whose dueDay has arrived, whose employee is not inactive, and that have no payment for the current reference month', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([]);

      await service.generateDueCharges();

      expect(prisma.employeeRecurringPayment.findMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          dueDay: { lte: 15 },
          employee: { status: { not: 'INACTIVE' } },
          payments: { none: { referenceYear: 2026, referenceMonth: 6 } },
        },
      });
    });

    it('calls generateCharge for each recurring payment returned and counts how many succeeded', async () => {
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([
        { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.employeeRecurringPayment.findFirst.mockResolvedValue({
        id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE',
      });
      employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
      prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1' });

      const result = await service.generateDueCharges();

      expect(prisma.employeePayment.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ checked: 1, generated: 1 });
    });

    it('ignores a ConflictException from one recurring payment and still processes the rest', async () => {
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([
        { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
        { id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.employeeRecurringPayment.findFirst
        .mockResolvedValueOnce({ id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' });
      employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
      prisma.employeePayment.create
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002', clientVersion: '5.22.0', meta: { target: ['recurringPaymentId', 'referenceYear', 'referenceMonth'] },
          }),
        )
        .mockResolvedValueOnce({ id: 'payment-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
    });

    it('logs but does not throw when a non-conflict error occurs, and still processes the remaining recurring payments', async () => {
      prisma.employeeRecurringPayment.findMany.mockResolvedValue([
        { id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' },
        { id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' },
      ]);
      prisma.employeeRecurringPayment.findFirst
        .mockResolvedValueOnce({ id: 'rec-1', companyId: 'company-1', employeeId: 'employee-1', description: 'Salário', amount: 5000, dueDay: 5, status: 'ACTIVE' })
        .mockResolvedValueOnce({ id: 'rec-2', companyId: 'company-1', employeeId: 'employee-2', description: 'Salário', amount: 6000, dueDay: 5, status: 'ACTIVE' });
      employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
      prisma.employeePayment.create
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValueOnce({ id: 'payment-2' });

      const result = await service.generateDueCharges();

      expect(result).toEqual({ checked: 2, generated: 1 });
    });
  });
});
