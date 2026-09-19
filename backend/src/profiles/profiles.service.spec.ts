import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { ProfilesService } from './profiles.service';
import { assertNotLastHolderOfPermission } from '../users/last-permission-holder.util';

jest.mock('../users/last-permission-holder.util');
jest.mock('../prisma/tenant-context', () => ({
  runInsideExplicitTenantTransaction: (fn: () => unknown) => fn(),
}));

function makePrisma() {
  return {
    profile: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  };
}

describe('ProfilesService', () => {
  describe('findAllForCompany', () => {
    it('lista perfis da empresa com contagem de usuários e grants', async () => {
      const prisma = makePrisma();
      prisma.profile.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'Administrador Geral', isProtected: true,
          permissions: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }],
          _count: { users: 1 },
        },
      ]);
      const service = new ProfilesService(prisma as any);

      const result = await service.findAllForCompany('company-1');

      expect(prisma.profile.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        include: { permissions: true, _count: { select: { users: true } } },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([{
        id: 'p1', name: 'Administrador Geral', isProtected: true, userCount: 1,
        grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }],
      }]);
    });
  });

  describe('findOne', () => {
    it('lança NotFoundException se o perfil não existir na empresa', async () => {
      const prisma = makePrisma();
      prisma.profile.findFirst.mockResolvedValue(null);
      const service = new ProfilesService(prisma as any);

      await expect(service.findOne('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('rejeita permissionCode desconhecido', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any);

      await expect(
        service.create('company-1', { name: 'Teste', grants: [{ permissionCode: 'inexistente.foo', scope: null }] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.profile.create).not.toHaveBeenCalled();
    });

    it('rejeita scope ausente numa permissão que exige scope', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any);

      await expect(
        service.create('company-1', { name: 'Teste', grants: [{ permissionCode: 'clientes.ver', scope: null }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita scope presente numa permissão sem validScopes', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any);

      await expect(
        service.create('company-1', { name: 'Teste', grants: [{ permissionCode: 'dashboard.ver', scope: Scope.EMPRESA }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita permissionCode duplicado na mesma lista', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any);

      await expect(
        service.create('company-1', {
          name: 'Teste',
          grants: [
            { permissionCode: 'dashboard.ver', scope: null },
            { permissionCode: 'dashboard.ver', scope: null },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cria o perfil com isProtected sempre false', async () => {
      const prisma = makePrisma();
      prisma.profile.create.mockResolvedValue({
        id: 'p2', name: 'Financeiro', isProtected: false,
        permissions: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }],
        _count: { users: 0 },
      });
      const service = new ProfilesService(prisma as any);

      const result = await service.create('company-1', {
        name: 'Financeiro',
        grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }],
      });

      expect(prisma.profile.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          name: 'Financeiro',
          isProtected: false,
          permissions: { create: [{ companyId: 'company-1', permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] },
        },
        include: { permissions: true, _count: { select: { users: true } } },
      });
      expect(result.userCount).toBe(0);
    });
  });

  describe('update', () => {
    // `assertNotLastHolderOfPermission` é mockado no nível do MÓDULO (`jest.mock(...)` no topo do
    // arquivo) — sem limpar entre os testes deste bloco, a contagem de chamadas se acumula de um
    // teste pro outro (a brief original não previa isso, e não havia nenhum `clearMocks`/
    // `resetMocks` configurado em `package.json`'s `jest` pra fazer isso implicitamente). Sem este
    // `beforeEach`, "NÃO chama a trava..." falha por causa das 2 chamadas acumuladas do teste
    // anterior, não por um bug real do código.
    beforeEach(() => {
      jest.clearAllMocks();
    });

    function makeTxPrisma(profileId: string, affectedUserIds: string[]) {
      const tx = {
        $executeRaw: jest.fn(),
        // `update` além de `findMany`: a brief original só previa `findMany`, mas
        // `recomputeAndSaveUserAccess` (Task 2, código real) chama `tx.user.update(...)` pra
        // gravar `modules`/`hasFullPontoAccess` recalculados — sem isso o mock quebra com
        // "tx.user.update is not a function" assim que o loop de recálculo roda. Corrigido aqui
        // pra refletir o comportamento real da função já implementada, não uma expectativa
        // desatualizada da brief (mesma classe de ajuste já registrada na Task 2).
        user: { findMany: jest.fn().mockResolvedValue(affectedUserIds.map((id) => ({ id }))), update: jest.fn() },
        profilePermission: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        profile: { update: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: profileId, permissions: [], _count: { users: 0 } }) },
        refreshToken: { updateMany: jest.fn() },
      };
      const prisma = {
        // Também precisa satisfazer `toPublicProfile` (permissions/_count): `update()` chama
        // `this.findOne(...)` no final, FORA da transação, reaproveitando este mesmo
        // `prisma.profile.findFirst` (não o `tx.profile.findFirst` acima, que fica sem uso) —
        // a brief original só previa o shape mínimo pra checagem de `isProtected`, mas o mesmo
        // mock resolve as duas chamadas.
        profile: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: profileId, isProtected: false, permissions: [], _count: { users: 0 } }),
        },
        $transaction: jest.fn((cb: any) => cb(tx)),
      };
      return { prisma, tx };
    }

    it('lança ForbiddenException se o perfil for protegido', async () => {
      const { prisma } = makeTxPrisma('p1', []);
      (prisma.profile.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', isProtected: true });
      const service = new ProfilesService(prisma as any);

      await expect(service.update('company-1', 'p1', { name: 'X', grants: [] })).rejects.toThrow(ForbiddenException);
    });

    it('lança NotFoundException se o perfil não existir na empresa', async () => {
      const { prisma } = makeTxPrisma('p1', []);
      (prisma.profile.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new ProfilesService(prisma as any);

      await expect(service.update('company-1', 'p1', { name: 'X', grants: [] })).rejects.toThrow(NotFoundException);
    });

    it('chama a trava de último detentor uma vez por usuário afetado ao remover usuarios.gerenciar', async () => {
      const { prisma, tx } = makeTxPrisma('p1', ['u1', 'u2']);
      const service = new ProfilesService(prisma as any);

      await service.update('company-1', 'p1', { name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] });

      expect(assertNotLastHolderOfPermission).toHaveBeenCalledTimes(2);
      expect(assertNotLastHolderOfPermission).toHaveBeenNthCalledWith(1, tx, 'company-1', 'usuarios.gerenciar', 'u1');
      expect(assertNotLastHolderOfPermission).toHaveBeenNthCalledWith(2, tx, 'company-1', 'usuarios.gerenciar', 'u2');
    });

    it('NÃO chama a trava se a nova lista ainda concede usuarios.gerenciar', async () => {
      const { prisma } = makeTxPrisma('p1', ['u1']);
      const service = new ProfilesService(prisma as any);

      await service.update('company-1', 'p1', { name: 'Admin', grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }] });

      expect(assertNotLastHolderOfPermission).not.toHaveBeenCalled();
    });

    it('regrava as ProfilePermission e recalcula cada usuário afetado', async () => {
      const { prisma, tx } = makeTxPrisma('p1', ['u1', 'u2']);
      const service = new ProfilesService(prisma as any);

      await service.update('company-1', 'p1', { name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] });

      expect(tx.profilePermission.deleteMany).toHaveBeenCalledWith({ where: { profileId: 'p1' } });
      expect(tx.profilePermission.createMany).toHaveBeenCalledWith({
        data: [{ companyId: 'company-1', profileId: 'p1', permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }],
      });
      expect(tx.profile.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { name: 'Financeiro' } });
      expect(tx.user.findMany).toHaveBeenCalledWith({ where: { profileId: 'p1', status: 'ACTIVE' } });
    });
  });
});
