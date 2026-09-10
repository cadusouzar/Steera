import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompanyContextService } from '../company/company-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from './employees.service';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: {
    employee: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
    employeeRecurringPayment: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      role: { findFirst: jest.fn() },
      employeeRecurringPayment: { updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    const module = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanyContextService, useValue: { getCurrentCompanyId: jest.fn().mockResolvedValue('company-1') } },
      ],
    }).compile();
    service = module.get(EmployeesService);
  });

  it('rejects creating an employee for a role from another company', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    await expect(
      service.create({
        fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-other-company',
        contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
        baseValue: 5000, paymentDueDay: 5,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects creating an employee with an inactive role', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: false });
    await expect(
      service.create({
        fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
        contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
        baseValue: 5000, paymentDueDay: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate CPF within the same company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: true });
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-existing' });
    await expect(
      service.create({
        fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
        contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
        baseValue: 5000, paymentDueDay: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('normalizes the CPF and scopes creation to the current company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: true });
    prisma.employee.findFirst.mockResolvedValue(null);
    prisma.employee.create.mockResolvedValue({ id: 'employee-1', cpf: '11122233344' });

    await service.create({
      fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
      contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
      baseValue: 5000, paymentDueDay: 5,
    });

    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', cpf: '11122233344' }),
    });
  });

  it('throws NotFoundException for an employee belonging to another company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.findOne('employee-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivating an employee flips status, sets terminationDate, and pauses active recurring payments in one transaction', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    // Mimics real Prisma: calling `.update()`/`.updateMany()` without awaiting
    // returns a (thenable) operation object synchronously, never `undefined` —
    // needed so the array built inline for `$transaction([...])` has non-nullish
    // elements for `expect.anything()` to match below.
    prisma.employee.update.mockReturnValue({});
    prisma.employeeRecurringPayment.updateMany.mockReturnValue({});
    prisma.$transaction.mockResolvedValue([{ id: 'employee-1', status: 'INACTIVE' }, { count: 2 }]);

    await service.deactivate('employee-1');

    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
  });
});
