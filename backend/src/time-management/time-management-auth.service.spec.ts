import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { effectiveHasFullPontoAccess } from '../auth/ponto-access.util';
import { PrismaService } from '../prisma/prisma.service';
import { TimeManagementAuthService } from './time-management-auth.service';

describe('TimeManagementAuthService', () => {
  let service: TimeManagementAuthService;
  let prisma: {
    user: Record<string, jest.Mock>;
    employee: Record<string, jest.Mock>;
  };

  const admin: AuthenticatedUser = {
    userId: 'user-admin', companyId: 'company-1', role: 'ADMIN', modules: [], mustChangePassword: false, hasFullPontoAccess: true,
  };
  const employeeLogin: AuthenticatedUser = {
    userId: 'user-employee', companyId: 'company-1', role: 'EMPLOYEE', modules: [], mustChangePassword: false, hasFullPontoAccess: true,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      employee: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [TimeManagementAuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(TimeManagementAuthService);
  });

  describe('canManage', () => {
    it('ADMIN can manage an employee that belongs to their own company', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: null });
      const result = await service.canManage(admin, 'target-1');
      expect(result).toBe(true);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({ where: { id: 'target-1', companyId: 'company-1' } });
      // O bypass de ADMIN nunca precisa consultar `user` — só `employee`, já escopado por empresa.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('ADMIN of a DIFFERENT company cannot manage a target employee that belongs to another company (regression guard: this was a real cross-tenant bypass, reproduced live via proactiveCorrect before this fix)', async () => {
      prisma.employee.findFirst.mockResolvedValue(null); // companyId filter excludes a cross-company target
      const result = await service.canManage(admin, 'target-other-company');
      expect(result).toBe(false);
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

    it('EMPLOYEE whose login has no linked employeeId can never manage, even when the target employee genuinely exists in the same company', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: 'someone' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: null });

      const result = await service.canManage(employeeLogin, 'target-1');

      expect(result).toBe(false);
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

    it('ADMIN with hasFullPontoAccess: false behaves exactly like an EMPLOYEE manager (no automatic bypass)', async () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: 'employee-manager-1' });

      const result = await service.canManage(limitedAdmin, 'target-1');

      expect(result).toBe(true); // direct manager, so still true — but via the manager path, not the bypass
      expect(prisma.user.findUnique).toHaveBeenCalled(); // proves it did NOT take the early-return bypass branch
    });

    it('ADMIN with hasFullPontoAccess: false cannot manage someone who is not their own direct report', async () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: 'someone-else' });

      const result = await service.canManage(limitedAdmin, 'target-1');

      expect(result).toBe(false);
    });
  });

  describe('assertCanManage', () => {
    it('resolves without throwing when canManage would return true', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', managerId: null });
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

  describe('getManageableEmployeeIds', () => {
    it("returns 'ALL' for ADMIN without querying anything", async () => {
      const result = await service.getManageableEmployeeIds(admin);
      expect(result).toBe('ALL');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('returns [] for an EMPLOYEE login with no linked employeeId', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: null });
      const result = await service.getManageableEmployeeIds(employeeLogin);
      expect(result).toEqual([]);
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
    });

    it('returns the ids of direct reports for an EMPLOYEE login that manages people, scoped to its own company', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'report-1' }, { id: 'report-2' }]);

      const result = await service.getManageableEmployeeIds(employeeLogin);

      expect(result).toEqual(['report-1', 'report-2']);
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { managerId: 'employee-manager-1', companyId: 'company-1' },
        select: { id: true },
      });
    });

    it('returns [] for an EMPLOYEE login with no direct reports', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findMany.mockResolvedValue([]);
      const result = await service.getManageableEmployeeIds(employeeLogin);
      expect(result).toEqual([]);
    });

    it("returns direct reports, not 'ALL', for ADMIN with hasFullPontoAccess: false", async () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: 'employee-manager-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'report-1' }]);

      const result = await service.getManageableEmployeeIds(limitedAdmin);

      expect(result).toEqual(['report-1']);
    });
  });

  describe('listManageableEmployees', () => {
    it('returns every ACTIVE employee in the company for ADMIN, without an id filter', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'e1', fullName: 'Ana' }, { id: 'e2', fullName: 'Beto' }]);

      const result = await service.listManageableEmployees(admin);

      expect(result).toEqual([{ id: 'e1', fullName: 'Ana' }, { id: 'e2', fullName: 'Beto' }]);
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', status: 'ACTIVE' },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      });
    });

    it('returns only direct reports for a manager, filtered by id', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findMany
        .mockResolvedValueOnce([{ id: 'report-1' }]) // getManageableEmployeeIds' own query
        .mockResolvedValueOnce([{ id: 'report-1', fullName: 'Carlos' }]); // the name-resolving query

      const result = await service.listManageableEmployees(employeeLogin);

      expect(result).toEqual([{ id: 'report-1', fullName: 'Carlos' }]);
      expect(prisma.employee.findMany).toHaveBeenLastCalledWith({
        where: { companyId: 'company-1', status: 'ACTIVE', id: { in: ['report-1'] } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      });
    });

    it('returns [] without querying employees when a manager has no direct reports', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findMany.mockResolvedValueOnce([]); // getManageableEmployeeIds' own query

      const result = await service.listManageableEmployees(employeeLogin);

      expect(result).toEqual([]);
      expect(prisma.employee.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // Achado I2 da revisão final (15/09/2026): o frontend derivava "tenho time próprio" de
  // listManageableEmployees().length > 0, que pra um ADMIN de acesso total é a empresa INTEIRA.
  describe('hasDirectReports', () => {
    it('queries direct reports for a full-access ADMIN too — never takes the ALL bypass', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: 'employee-admin-1' });
      prisma.employee.count.mockResolvedValue(0);

      const result = await service.hasDirectReports(admin);

      expect(result).toBe(false); // admin de acesso total SEM subordinados diretos
      expect(prisma.employee.count).toHaveBeenCalledWith({
        where: { managerId: 'employee-admin-1', companyId: 'company-1', status: 'ACTIVE' },
      });
    });

    it('returns true for a login whose linked Employee is the managerId of someone active', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.count.mockResolvedValue(2);

      expect(await service.hasDirectReports(employeeLogin)).toBe(true);
    });

    it('returns false (without querying employees) when the login has no linked Employee', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-admin', employeeId: null });

      expect(await service.hasDirectReports(admin)).toBe(false);
      expect(prisma.employee.count).not.toHaveBeenCalled();
    });
  });

  describe('assertHasFullPontoAccess', () => {
    it('does not throw for ADMIN with hasFullPontoAccess: true', () => {
      expect(() => service.assertHasFullPontoAccess(admin)).not.toThrow();
    });

    it('throws NotFoundException for ADMIN with hasFullPontoAccess: false', () => {
      const limitedAdmin: AuthenticatedUser = { ...admin, hasFullPontoAccess: false };
      expect(() => service.assertHasFullPontoAccess(limitedAdmin)).toThrow(NotFoundException);
    });

    it('throws NotFoundException for any EMPLOYEE login, regardless of hasFullPontoAccess', () => {
      expect(() => service.assertHasFullPontoAccess(employeeLogin)).toThrow(NotFoundException);
    });
  });

  // Achado I4 da revisão final (15/09/2026): TODO teste e toda a verificação em navegador deste
  // plano usaram logins ADMIN (de acesso total ou restrito) — nunca um login EMPLOYEE-gerente, que
  // é exatamente a persona pra quem o plano existe. Foi por isso que o C2 (frontend e backend
  // discordando do significado de hasFullPontoAccess) passou por 12 revisões de task.
  describe('EMPLOYEE-role manager (a persona nunca exercitada antes desta revisão)', () => {
    // O flag EFETIVO que um login EMPLOYEE chega a ver é sempre false — normalizado na borda de
    // auth (ver effectiveHasFullPontoAccess), mesmo com a coluna do banco em `true`, que é como
    // TODA linha nasce. Este teste ancora as duas pontas: o valor normalizado e a consequência
    // dele nos guards deste serviço.
    const employeeManagerFromJwt: AuthenticatedUser = {
      ...employeeLogin,
      hasFullPontoAccess: effectiveHasFullPontoAccess({ role: 'EMPLOYEE', hasFullPontoAccess: true }),
    };

    it('never carries an effective hasFullPontoAccess of true, even with the DB column set to true', () => {
      expect(employeeManagerFromJwt.hasFullPontoAccess).toBe(false);
    });

    it('is denied every full-access action (company-wide settings/schedules, work locations, ponto-access toggle)', () => {
      expect(() => service.assertHasFullPontoAccess(employeeManagerFromJwt)).toThrow(NotFoundException);
    });

    it('can still manage its OWN direct reports (the whole point of the persona)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'report-1', companyId: 'company-1', managerId: 'employee-manager-1' });

      expect(await service.canManage(employeeManagerFromJwt, 'report-1')).toBe(true);
    });

    it('cannot manage someone who is not its direct report', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'other-1', companyId: 'company-1', managerId: 'someone-else' });

      expect(await service.canManage(employeeManagerFromJwt, 'other-1')).toBe(false);
    });

    it('sees only its direct reports in the manageable list, never the whole company', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.findMany
        .mockResolvedValueOnce([{ id: 'report-1' }])
        .mockResolvedValueOnce([{ id: 'report-1', fullName: 'Carlos' }]);

      const result = await service.listManageableEmployees(employeeManagerFromJwt);

      expect(result).toEqual([{ id: 'report-1', fullName: 'Carlos' }]);
      expect(prisma.employee.findMany).toHaveBeenLastCalledWith({
        where: { companyId: 'company-1', status: 'ACTIVE', id: { in: ['report-1'] } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      });
    });

    it('does have a team of its own (hasDirectReports), which is what unlocks the team-scoped config', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-employee', employeeId: 'employee-manager-1' });
      prisma.employee.count.mockResolvedValue(1);

      expect(await service.hasDirectReports(employeeManagerFromJwt)).toBe(true);
    });
  });
});
