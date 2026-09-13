import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      user: { findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
      company: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(UsersService);
  });

  it('rejects creating an EMPLOYEE login without employeeId', async () => {
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login for an employee from another company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating a second login for an employee that already has one', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login once the plan limit is reached', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(10);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates an EMPLOYEE login under the plan limit and returns a one-time temporary password', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(9);
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@a.com', role: 'EMPLOYEE' });
    const result = await service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: ['RH'] } as any);
    expect(result.temporaryPassword).toHaveLength(16);
    expect(result.user.id).toBe('u1');
  });

  it('creates an ADMIN login without checking the employee-linked plan limit', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin2@a.com', role: 'ADMIN' });
    const result = await service.create('c1', { email: 'admin2@a.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any);
    expect(result.user.id).toBe('u2');
    expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('block scopes the lookup to the current company and revokes active refresh tokens', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
    await service.block('c1', 'u1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('block 404s for a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.block('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(BadRequestException);
  });
});
