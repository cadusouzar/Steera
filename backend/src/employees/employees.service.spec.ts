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
      include: { manager: { select: { fullName: true } } },
    });
  });

  it('throws NotFoundException for an employee belonging to another company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.findOne('employee-other-company')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('accepts a managerId belonging to a valid employee in the same company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: true });
    prisma.employee.findFirst
      .mockResolvedValueOnce(null) // CPF conflict check
      .mockResolvedValueOnce({ id: 'manager-1', companyId: 'company-1', managerId: null }); // assertManagerUsable
    prisma.employee.create.mockResolvedValue({ id: 'employee-1', managerId: 'manager-1' });

    await service.create({
      fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
      contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
      baseValue: 5000, paymentDueDay: 5, managerId: 'manager-1',
    });

    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ managerId: 'manager-1' }),
      include: { manager: { select: { fullName: true } } },
    });
  });

  it('rejects a managerId belonging to an employee from another company', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', companyId: 'company-1', active: true });
    prisma.employee.findFirst
      .mockResolvedValueOnce(null) // CPF conflict check
      .mockResolvedValueOnce(null); // assertManagerUsable: not found scoped to company-1

    await expect(
      service.create({
        fullName: 'João Silva', cpf: '111.222.333-44', roleId: 'role-1',
        contractType: 'CLT' as never, admissionDate: '2026-01-01', department: 'Tecnologia',
        baseValue: 5000, paymentDueDay: 5, managerId: 'manager-other-company',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects setting managerId equal to the employee\'s own id on update', async () => {
    prisma.employee.findFirst
      .mockResolvedValueOnce({ id: 'employee-1', companyId: 'company-1', roleId: 'role-1', managerId: null }) // assertExists
      .mockResolvedValueOnce({ id: 'employee-1', companyId: 'company-1', managerId: null }); // assertManagerUsable lookup

    await expect(service.update('employee-1', { managerId: 'employee-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a direct 2-node cycle (A managed by B, B would become managed by A)', async () => {
    // employee-1 (A) is being updated to have manager-1 (B) as its manager,
    // but manager-1's own managerId is already employee-1 (A) — direct cycle.
    prisma.employee.findFirst
      .mockResolvedValueOnce({ id: 'employee-1', companyId: 'company-1', roleId: 'role-1', managerId: null }) // assertExists
      .mockResolvedValueOnce({ id: 'manager-1', companyId: 'company-1', managerId: 'employee-1' }); // assertManagerUsable lookup

    await expect(service.update('employee-1', { managerId: 'manager-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivating an employee flips status, sets terminationDate, and pauses active recurring payments in one transaction', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
    const tx = {
      employee: { update: jest.fn().mockResolvedValue({ id: 'employee-1', status: 'INACTIVE' }) },
      employeeRecurringPayment: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

    const result = await service.deactivate('employee-1');

    expect(tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'employee-1' },
      data: { status: 'INACTIVE', terminationDate: expect.any(Date) },
    });
    expect(tx.employeeRecurringPayment.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1', status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    });
    expect(result).toEqual({ id: 'employee-1', status: 'INACTIVE' });
  });

  it('calls update/updateMany inside the same transaction callback, and rolls back if the second operation fails (atomicity)', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', status: 'ACTIVE' });
    const tx = {
      employee: { update: jest.fn().mockResolvedValue({ id: 'employee-1', status: 'INACTIVE' }) },
      employeeRecurringPayment: { updateMany: jest.fn().mockRejectedValue(new Error('falha simulada')) },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

    await expect(service.deactivate('employee-1')).rejects.toThrow('falha simulada');

    expect(tx.employee.update).toHaveBeenCalledWith({
      where: { id: 'employee-1' },
      data: expect.objectContaining({ status: 'INACTIVE' }),
    });
    expect(tx.employeeRecurringPayment.updateMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-1', status: 'ACTIVE' },
      data: { status: 'INACTIVE' },
    });
  });
});
