import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { ProfilesService } from './profiles.service';
import { assertOtherProfileGrantsPermission } from '../users/last-permission-holder.util';
import { reassignUserProfile } from '../permissions/profile-assignment.util';

jest.mock('../users/last-permission-holder.util');
jest.mock('../permissions/profile-assignment.util', () => ({
  ...jest.requireActual('../permissions/profile-assignment.util'),
  reassignUserProfile: jest.fn(),
}));
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
    // `assertOtherProfileGrantsPermission` é mockada no nível do MÓDULO (`jest.mock(...)` no topo
    // do arquivo) — sem limpar entre os testes deste bloco, a contagem de chamadas se acumula de
    // um teste pro outro (não havia nenhum `clearMocks`/`resetMocks` configurado em
    // `package.json`'s `jest` pra fazer isso implicitamente). Sem este `beforeEach`, "NÃO chama a
    // trava..." falharia por causa de chamadas acumuladas do teste anterior, não por um bug real
    // do código.
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

    // Corrigido na rodada de revisão de segurança pós-implementação: a versão original chamava
    // `assertNotLastHolderOfPermission` uma vez POR USUÁRIO afetado, ANTES da reescrita em lote
    // das ProfilePermission — o que deixava passar um lote que zerava por completo os detentores
    // de `usuarios.gerenciar` da empresa quando TODOS os usuários de um perfil compartilhado
    // perdiam a permissão ao mesmo tempo (ver task-4-report.md, seção "Rodada de correção", pro
    // passo a passo completo). `assertOtherProfileGrantsPermission` substitui essa checagem por
    // UMA chamada só, por PERFIL sendo editado, não por usuário.
    it('chama assertOtherProfileGrantsPermission uma única vez, pelo PERFIL sendo editado, ao remover usuarios.gerenciar', async () => {
      const { prisma, tx } = makeTxPrisma('p1', ['u1', 'u2']);
      const service = new ProfilesService(prisma as any);

      await service.update('company-1', 'p1', { name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] });

      expect(assertOtherProfileGrantsPermission).toHaveBeenCalledTimes(1);
      expect(assertOtherProfileGrantsPermission).toHaveBeenCalledWith(tx, 'company-1', 'usuarios.gerenciar', 'p1');
    });

    it('NÃO chama a trava se a nova lista ainda concede usuarios.gerenciar', async () => {
      const { prisma } = makeTxPrisma('p1', ['u1']);
      const service = new ProfilesService(prisma as any);

      await service.update('company-1', 'p1', { name: 'Admin', grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }] });

      expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
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

describe('remove', () => {
  it('lança ForbiddenException se o perfil for protegido', async () => {
    const prisma = {
      profile: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: true, _count: { users: 0 } }) },
    };
    const service = new ProfilesService(prisma as any);

    await expect(service.remove('company-1', 'p1')).rejects.toThrow(ForbiddenException);
  });

  it('lança NotFoundException se o perfil não existir na empresa', async () => {
    const prisma = { profile: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new ProfilesService(prisma as any);

    await expect(service.remove('company-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('lança BadRequestException se o perfil ainda estiver em uso', async () => {
    const prisma = {
      profile: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: false, _count: { users: 3 } }) },
    };
    const service = new ProfilesService(prisma as any);

    await expect(service.remove('company-1', 'p1')).rejects.toThrow(BadRequestException);
  });

  it('exclui um perfil não-protegido sem usuários', async () => {
    const prisma = {
      profile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: false, _count: { users: 0 } }),
        delete: jest.fn(),
      },
    };
    const service = new ProfilesService(prisma as any);

    await service.remove('company-1', 'p1');

    expect(prisma.profile.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });
});

describe('reassignAndDelete', () => {
  // `assertOtherProfileGrantsPermission`/`reassignUserProfile` são mockadas no nível do MÓDULO —
  // sem limpar entre os testes deste bloco, a contagem de chamadas se acumula de um teste pro
  // outro (mesmo motivo já documentado no `beforeEach` do describe('update') acima).
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeTxPrisma() {
    const tx = {
      $executeRaw: jest.fn(),
      profilePermission: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
      profile: { delete: jest.fn() },
    };
    const prisma = {
      profile: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'source', isProtected: false })
          .mockResolvedValueOnce({ id: 'target' }),
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    return { prisma, tx };
  }

  it('lança BadRequestException se destino for igual à origem', async () => {
    const prisma = { profile: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: false }) } };
    const service = new ProfilesService(prisma as any);

    await expect(
      service.reassignAndDelete('company-1', 'p1', { targetProfileId: 'p1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lança NotFoundException se a origem não existir na empresa', async () => {
    const prisma = {
      profile: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'target' }) },
    };
    const service = new ProfilesService(prisma as any);

    await expect(
      service.reassignAndDelete('company-1', 'missing', { targetProfileId: 'target' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('lança ForbiddenException se a origem for protegida', async () => {
    const prisma = {
      profile: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'source', isProtected: true })
          .mockResolvedValueOnce({ id: 'target' }),
      },
    };
    const service = new ProfilesService(prisma as any);

    await expect(
      service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lança NotFoundException se o destino não existir na empresa', async () => {
    const prisma = {
      profile: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 'source', isProtected: false }).mockResolvedValueOnce(null),
      },
    };
    const service = new ProfilesService(prisma as any);

    await expect(
      service.reassignAndDelete('company-1', 'source', { targetProfileId: 'missing' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('reatribui cada usuário sequencialmente e exclui o perfil de origem', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    const service = new ProfilesService(prisma as any);

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' });

    expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
    expect(reassignUserProfile).toHaveBeenNthCalledWith(1, tx, 'u1', 'target');
    expect(reassignUserProfile).toHaveBeenNthCalledWith(2, tx, 'u2', 'target');
    expect(tx.profile.delete).toHaveBeenCalledWith({ where: { id: 'source' } });
  });

  // Correção deliberada em relação à brief original desta task (ver task-5-report.md): a checagem
  // de último detentor não é mais uma vez POR USUÁRIO afetado — é uma única chamada de
  // `assertOtherProfileGrantsPermission`, pelo PERFIL de origem sendo esvaziado, exatamente o
  // mesmo padrão já corrigido em `update()` (ver `describe('update')` acima e
  // `last-permission-holder.util.ts`).
  it('chama assertOtherProfileGrantsPermission uma única vez, pelo perfil de ORIGEM, se a origem concede usuarios.gerenciar e o destino não', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany
      .mockResolvedValueOnce([{ permissionCode: 'usuarios.gerenciar' }])
      .mockResolvedValueOnce([]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    const service = new ProfilesService(prisma as any);

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' });

    expect(assertOtherProfileGrantsPermission).toHaveBeenCalledTimes(1);
    expect(assertOtherProfileGrantsPermission).toHaveBeenCalledWith(tx, 'company-1', 'usuarios.gerenciar', 'source');
  });

  it('NÃO chama a trava se o destino também concede usuarios.gerenciar', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany
      .mockResolvedValueOnce([{ permissionCode: 'usuarios.gerenciar' }])
      .mockResolvedValueOnce([{ permissionCode: 'usuarios.gerenciar' }]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    const service = new ProfilesService(prisma as any);

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' });

    expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
  });

  it('NÃO chama a trava se o destino não concede a permissão mas a origem também não concedia', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    const service = new ProfilesService(prisma as any);

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' });

    expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
  });
});
