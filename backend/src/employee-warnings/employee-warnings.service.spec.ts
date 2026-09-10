import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmployeesService } from '../employees/employees.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeWarningsService } from './employee-warnings.service';

describe('EmployeeWarningsService', () => {
  let service: EmployeeWarningsService;
  let prisma: { employeeWarning: Record<string, jest.Mock> };
  let employeesService: { assertExists: jest.Mock };

  beforeEach(async () => {
    prisma = { employeeWarning: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() } };
    employeesService = { assertExists: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        EmployeeWarningsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmployeesService, useValue: employeesService },
      ],
    }).compile();
    service = module.get(EmployeeWarningsService);
  });

  it('rejects creating a warning for an employee that does not exist (or belongs to another company)', async () => {
    employeesService.assertExists.mockRejectedValue(new NotFoundException());
    await expect(service.create('missing-employee', { occurredAt: '2026-01-01', reason: 'Atraso' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.employeeWarning.create).not.toHaveBeenCalled();
  });

  it('creates a warning scoped to the employee and its company', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeeWarning.create.mockResolvedValue({ id: 'warning-1' });

    await service.create('employee-1', { occurredAt: '2026-01-01', reason: 'Atraso injustificado' });

    expect(prisma.employeeWarning.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', employeeId: 'employee-1', reason: 'Atraso injustificado' }),
    });
  });

  it('lists warnings only for the given employee', async () => {
    employeesService.assertExists.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
    prisma.employeeWarning.findMany.mockResolvedValue([]);
    await service.findAllForEmployee('employee-1');
    expect(prisma.employeeWarning.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1' },
      orderBy: { occurredAt: 'desc' },
    });
  });
});
