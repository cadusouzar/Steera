import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { ProfilesService } from './profiles.service';

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
});
