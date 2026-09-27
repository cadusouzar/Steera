import { NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Scope } from '@prisma/client';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuthorizationService } from './authorization.service';
import { EmployeeScopeService } from './employee-scope.service';

describe('EmployeeScopeService', () => {
  const buildUser = (permissions: Record<string, Scope | null>): AuthenticatedUser => ({
    userId: 'user-1',
    companyId: 'company-1',
    role: 'EMPLOYEE',
    modules: [],
    mustChangePassword: false,
    hasFullPontoAccess: false,
    permissions,
  });

  const buildService = async (user: AuthenticatedUser, authorization: Partial<AuthorizationService> = {}) => {
    const authorizationMock = { resolveScope: jest.fn(), ...authorization };
    const module = await Test.createTestingModule({
      providers: [
        EmployeeScopeService,
        { provide: REQUEST, useValue: { user } },
        { provide: AuthorizationService, useValue: authorizationMock },
      ],
    }).compile();
    const service = await module.resolve(EmployeeScopeService);
    return { service, authorizationMock };
  };

  describe('allowedEmployeeIds', () => {
    it('returns [] when the permission is absent from the JWT claim', async () => {
      const { service, authorizationMock } = await buildService(buildUser({}));
      await expect(service.allowedEmployeeIds('funcionarios.ver')).resolves.toEqual([]);
      expect(authorizationMock.resolveScope).not.toHaveBeenCalled();
    });

    it("returns 'ALL' when the permission is present with a null scope (no-scope permission)", async () => {
      const { service, authorizationMock } = await buildService(buildUser({ 'usuarios.gerenciar': null }));
      await expect(service.allowedEmployeeIds('usuarios.gerenciar')).resolves.toBe('ALL');
      expect(authorizationMock.resolveScope).not.toHaveBeenCalled();
    });

    it("delegates to AuthorizationService.resolveScope and returns 'ALL' for EMPRESA", async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue('ALL') };
      const { service } = await buildService(buildUser({ 'clientes.ver': Scope.EMPRESA }), authorizationMock);
      await expect(service.allowedEmployeeIds('clientes.ver')).resolves.toBe('ALL');
      expect(authorizationMock.resolveScope).toHaveBeenCalledWith(Scope.EMPRESA, expect.objectContaining({ userId: 'user-1' }));
    });

    it('resolves PROPRIO to just the caller\'s own employee id', async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue(['emp-1']) };
      const { service } = await buildService(buildUser({ 'funcionarios.ver': Scope.PROPRIO }), authorizationMock);
      await expect(service.allowedEmployeeIds('funcionarios.ver')).resolves.toEqual(['emp-1']);
    });

    it('caches the resolution per requisição (resolveScope chamado uma vez por código, mesmo com múltiplas chamadas)', async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue(['emp-1', 'emp-2']) };
      const { service } = await buildService(buildUser({ 'funcionarios.ver': Scope.EQUIPE }), authorizationMock);
      await service.allowedEmployeeIds('funcionarios.ver');
      await service.allowedEmployeeIds('funcionarios.ver');
      await service.allowedEmployeeIds('funcionarios.ver');
      expect(authorizationMock.resolveScope).toHaveBeenCalledTimes(1);
    });
  });

  describe('assertEmployeeInScope', () => {
    it('resolves without throwing when the employee id is within scope', async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue(['emp-1']) };
      const { service } = await buildService(buildUser({ 'funcionarios.ver': Scope.PROPRIO }), authorizationMock);
      await expect(service.assertEmployeeInScope('funcionarios.ver', 'emp-1')).resolves.toBeUndefined();
    });

    it("never throws when the scope is 'ALL'", async () => {
      const { service } = await buildService(buildUser({ 'usuarios.gerenciar': null }));
      await expect(service.assertEmployeeInScope('usuarios.gerenciar', 'any-employee')).resolves.toBeUndefined();
    });

    it('throws the same NotFoundException message as EmployeesService.findOne when out of scope', async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue(['emp-1']) };
      const { service } = await buildService(buildUser({ 'funcionarios.ver': Scope.PROPRIO }), authorizationMock);
      await expect(service.assertEmployeeInScope('funcionarios.ver', 'emp-2')).rejects.toThrow(NotFoundException);
      await expect(service.assertEmployeeInScope('funcionarios.ver', 'emp-2')).rejects.toThrow(
        'Funcionário emp-2 não encontrado',
      );
    });

    it('throws when the permission is entirely absent (empty scope)', async () => {
      const { service } = await buildService(buildUser({}));
      await expect(service.assertEmployeeInScope('funcionarios.ver', 'emp-1')).rejects.toThrow(NotFoundException);
    });

    // Task 4: rotas endereçadas pelo id de um registro dependente (pagamento, agendamento...) usam
    // a mensagem de "não encontrado" do PRÓPRIO recurso, nunca a de funcionário.
    it('uses the given not-found message instead of the employee one when provided', async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue(['emp-1']) };
      const { service } = await buildService(buildUser({ 'pagamentos.gerenciar': Scope.PROPRIO }), authorizationMock);
      await expect(
        service.assertEmployeeInScope('pagamentos.gerenciar', 'emp-2', 'Pagamento p-1 não encontrado'),
      ).rejects.toThrow(new NotFoundException('Pagamento p-1 não encontrado'));
    });
  });

  describe('whereEmployeeIn', () => {
    it("returns {} when the scope is 'ALL'", async () => {
      const { service } = await buildService(buildUser({ 'usuarios.gerenciar': null }));
      await expect(service.whereEmployeeIn('usuarios.gerenciar')).resolves.toEqual({});
    });

    it('returns an `in` filter on the default field (id) otherwise', async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue(['emp-1', 'emp-2']) };
      const { service } = await buildService(buildUser({ 'funcionarios.ver': Scope.EQUIPE }), authorizationMock);
      await expect(service.whereEmployeeIn('funcionarios.ver')).resolves.toEqual({ id: { in: ['emp-1', 'emp-2'] } });
    });

    it('applies the given field name instead of id', async () => {
      const authorizationMock = { resolveScope: jest.fn().mockResolvedValue(['emp-1']) };
      const { service } = await buildService(buildUser({ 'funcionarios.ver': Scope.PROPRIO }), authorizationMock);
      await expect(service.whereEmployeeIn('funcionarios.ver', 'employeeId')).resolves.toEqual({
        employeeId: { in: ['emp-1'] },
      });
    });
  });
});
