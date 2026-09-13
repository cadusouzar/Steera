import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      user: {
        findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(),
        create: jest.fn(), update: jest.fn(),
      },
      company: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(UsersService);
  });

  it('findAllForCompany never selects passwordHash', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.findAllForCompany('c1');
    const call = prisma.user.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ companyId: 'c1' });
    expect(call.select).toBeDefined();
    expect(call.select.passwordHash).toBeUndefined();
  });

  it('create never selects passwordHash back for the created user', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin3@a.com', role: 'ADMIN' });
    await service.create('c1', { email: 'admin3@a.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any);
    const call = prisma.user.create.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.passwordHash).toBeUndefined();
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

  it('rejects creating a login with an e-mail already used by ANY company with a clean 409 instead of an unhandled 500', async () => {
    // User.email é único GLOBALMENTE, não por empresa — mesmo padrão/mesmo
    // bug já corrigido em AuthService.register() (ver auth.service.spec.ts).
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      }),
    );
    await expect(
      service.create('c1', { email: 'ja-existe-em-outra-empresa@test.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any),
    ).rejects.toBeInstanceOf(ConflictException);
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
    await expect(service.block('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unblock 404s for a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.unblock('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(NotFoundException);
  });
});
