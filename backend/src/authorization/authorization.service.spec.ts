import { Test } from '@nestjs/testing';
import { Scope } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  let service: AuthorizationService;
  let prisma: any;

  const employeeLogin: AuthenticatedUser = {
    userId: 'user-1', companyId: 'company-1', role: 'EMPLOYEE', modules: [], mustChangePassword: false, hasFullPontoAccess: false,
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      employee: { findMany: jest.fn(), findUnique: jest.fn() },
      profilePermission: { findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [AuthorizationService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(AuthorizationService);
  });

  describe('getEffectivePermissions', () => {
    it('returns a map of permissionCode to scope for the user\'s profile', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', profileId: 'profile-1' });
      prisma.profilePermission.findMany.mockResolvedValue([
        { permissionCode: 'funcionarios.ver', scope: 'EQUIPE' },
        { permissionCode: 'dashboard.ver', scope: null },
      ]);
      const result = await service.getEffectivePermissions('user-1');
      expect(result).toEqual({ 'funcionarios.ver': 'EQUIPE', 'dashboard.ver': null });
    });

    it('returns an empty map when the user has no profile assigned', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', profileId: null });
      const result = await service.getEffectivePermissions('user-1');
      expect(result).toEqual({});
      expect(prisma.profilePermission.findMany).not.toHaveBeenCalled();
    });
  });

  describe('resolveScope', () => {
    it('EMPRESA resolves to the ALL sentinel', async () => {
      const result = await service.resolveScope(Scope.EMPRESA, employeeLogin);
      expect(result).toBe('ALL');
    });

    it('EQUIPE resolves via hierarquia (subordinados diretos)', async () => {
      prisma.user.findUnique.mockResolvedValue({ employeeId: 'emp-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-2' }]);
      const result = await service.resolveScope(Scope.EQUIPE, employeeLogin);
      expect(result).toEqual(['emp-2']);
    });

    it('DEPARTAMENTO resolves to employees sharing the caller\'s departmentId', async () => {
      prisma.user.findUnique.mockResolvedValue({ employeeId: 'emp-1' });
      prisma.employee.findUnique.mockResolvedValue({ departmentId: 'dept-1' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-3' }]);
      const result = await service.resolveScope(Scope.DEPARTAMENTO, employeeLogin);
      expect(result).toEqual(['emp-3']);
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { departmentId: 'dept-1', companyId: 'company-1' },
        select: { id: true },
      });
    });

    it('PROPRIO resolves to just the caller\'s own employeeId', async () => {
      prisma.user.findUnique.mockResolvedValue({ employeeId: 'emp-1' });
      const result = await service.resolveScope(Scope.PROPRIO, employeeLogin);
      expect(result).toEqual(['emp-1']);
    });

    it('caso de borda: sem Employee vinculado, PROPRIO/EQUIPE/DEPARTAMENTO resolvem vazio, nunca erro', async () => {
      prisma.user.findUnique.mockResolvedValue({ employeeId: null });
      await expect(service.resolveScope(Scope.PROPRIO, employeeLogin)).resolves.toEqual([]);
      await expect(service.resolveScope(Scope.EQUIPE, employeeLogin)).resolves.toEqual([]);
      await expect(service.resolveScope(Scope.DEPARTAMENTO, employeeLogin)).resolves.toEqual([]);
    });

    it('caso de borda: DEPARTAMENTO sem departmentId no próprio Employee resolve vazio', async () => {
      prisma.user.findUnique.mockResolvedValue({ employeeId: 'emp-1' });
      prisma.employee.findUnique.mockResolvedValue({ departmentId: null });
      const result = await service.resolveScope(Scope.DEPARTAMENTO, employeeLogin);
      expect(result).toEqual([]);
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
    });
  });
});
