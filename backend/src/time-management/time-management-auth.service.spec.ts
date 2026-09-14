import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from './time-management-auth.service';

describe('TimeManagementAuthService', () => {
  let service: TimeManagementAuthService;
  let prisma: {
    user: Record<string, jest.Mock>;
    employee: Record<string, jest.Mock>;
  };

  const admin: AuthenticatedUser = {
    userId: 'user-admin', companyId: 'company-1', role: 'ADMIN', modules: [], mustChangePassword: false,
  };
  const employeeLogin: AuthenticatedUser = {
    userId: 'user-employee', companyId: 'company-1', role: 'EMPLOYEE', modules: [], mustChangePassword: false,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      employee: { findFirst: jest.fn(), findUnique: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [TimeManagementAuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TimeManagementAuthService);
  });

  describe('canManage', () => {
    it('ADMIN can always manage, without looking up any employee', async () => {
      const result = await service.canManage(admin, 'target-1');
      expect(result).toBe(true);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('EMPLOYEE who is the direct managerId of the target can manage', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: 'employee-manager-1' });

      const result = await service.canManage(employeeLogin, 'target-1');

      expect(result).toBe(true);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'target-1', companyId: 'company-1' },
      });
    });

    it('EMPLOYEE whose login has no linked employeeId can never manage', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: null });

      const result = await service.canManage(employeeLogin, 'target-1');

      expect(result).toBe(false);
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it('EMPLOYEE from another company can never manage (companyId filter finds nothing)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue(null);

      const result = await service.canManage(employeeLogin, 'target-other-company');

      expect(result).toBe(false);
    });

    it('EMPLOYEE who is not the direct superior of the target cannot manage', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: 'someone-else' });

      const result = await service.canManage(employeeLogin, 'target-1');

      expect(result).toBe(false);
    });
  });

  describe('assertCanManage', () => {
    it('resolves without throwing when canManage would return true', async () => {
      await expect(service.assertCanManage(admin, 'target-1')).resolves.toBeUndefined();
    });

    it('throws NotFoundException (never ForbiddenException) when canManage would return false', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: null });
      await expect(service.assertCanManage(employeeLogin, 'target-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveOwnEmployee', () => {
    it('returns the Employee when the login has an active linked employee', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-1' });
      const activeEmployee = { id: 'employee-1', status: 'ACTIVE' };
      prisma.employee.findUnique.mockResolvedValue(activeEmployee);

      const result = await service.resolveOwnEmployee(employeeLogin);

      expect(result).toBe(activeEmployee);
    });

    it('throws ForbiddenException when the login has no linked employeeId', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: null });
      await expect(service.resolveOwnEmployee(admin)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when the linked employee is INACTIVE', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-1' });
      prisma.employee.findUnique.mockResolvedValue({ id: 'employee-1', status: 'INACTIVE' });

      await expect(service.resolveOwnEmployee(employeeLogin)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
