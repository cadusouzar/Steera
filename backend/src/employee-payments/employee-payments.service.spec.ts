import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeePaymentsService } from './employee-payments.service';

describe('EmployeePaymentsService', () => {
  let service: EmployeePaymentsService;
  let prisma: { employeePayment: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = {
      employeePayment: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        EmployeePaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(EmployeePaymentsService);
  });

  it('creates a one-off payment for the given employee', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1' });

    await service.create('employee-1', { description: 'Bônus', amount: 500, dueDate: '2026-10-05' });

    expect(prisma.employeePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', amount: 500 }),
    });
  });

  it('marking a payment as paid records paidAt', async () => {
    prisma.employeePayment.findFirst.mockResolvedValue({ id: 'payment-1' });
    prisma.employeePayment.update.mockResolvedValue({ id: 'payment-1', status: 'PAID' });
    await service.pay('payment-1');
    expect(prisma.employeePayment.update).toHaveBeenCalledWith({
      where: { id: 'payment-1' },
      data: { status: 'PAID', paidAt: expect.any(Date) },
    });
  });

  it('derives overdue status from a pending payment with a past due date, without persisting it', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeePayment.findMany.mockResolvedValue([
      { id: 'payment-1', status: 'PENDING', dueDate: new Date('2000-01-01T00:00:00Z') },
    ]);
    prisma.employeePayment.count.mockResolvedValue(1);

    const result = await service.findAllForEmployee('employee-1', {});

    expect(result.items[0].derivedStatus).toBe('overdue');
  });

  it('filters nested payment listings by companyId too, not just employeeId', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeePayment.findMany.mockResolvedValue([]);
    prisma.employeePayment.count.mockResolvedValue(0);

    await service.findAllForEmployee('employee-1', {});

    expect(prisma.employeePayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'employee-1', companyId: 'company-1' } }),
    );
    expect(prisma.employeePayment.count).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1', companyId: 'company-1' },
    });
  });

  it('allows a one-off payment for an inactive employee (rescisão/pagamento final)', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'INACTIVE' });
    prisma.employeePayment.create.mockResolvedValue({ id: 'payment-1', status: 'PENDING', dueDate: new Date('2999-01-01') });

    await service.create('employee-1', { description: 'Rescisão', amount: 8000, dueDate: '2026-10-05' });

    expect(prisma.employeePayment.create).toHaveBeenCalled();
  });

  it('scopes the lookup to the current company (missing id or another company both 404)', async () => {
    prisma.employeePayment.findFirst.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.employeePayment.findFirst).toHaveBeenCalledWith({ where: { id: 'missing', companyId: 'company-1' } });
  });
});
