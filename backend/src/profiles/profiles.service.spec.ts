import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Scope } from '@prisma/client';
import { ProfilesService } from './profiles.service';
import {
  assertOtherAdminGrantsFullPontoAccess,
  assertOtherProfileGrantsPermission,
} from '../users/last-permission-holder.util';
import { reassignUserProfile } from '../permissions/profile-assignment.util';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';

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

// `assertHasFullPontoAccess` REAL (não um jest.fn() vazio): o gate restaurado na revisão final da
// branch (22/09/2026) só protege de verdade se o teste exercitar a mesma regra que o backend aplica
// (404 pra quem não é ADMIN de acesso total). O construtor só precisa de prisma pros OUTROS
// métodos, nenhum deles usado aqui.
function makeTimeAuth() {
  return new TimeManagementAuthService({} as any);
}

// Concessão limitada (28/09/2026): o poder do chamador vem do banco (getEffectivePermissions) e os
// grants ATUAIS de um perfil de getProfileGrants. Padrão: chamador com o catálogo inteiro no alcance
// máximo (como o Administrador Geral), então passa por toda checagem de poder — a intenção dos
// testes existentes não muda. `profileGrants` mapeia profileId → grants atuais (padrão: nenhum).
function fullCallerGrants(): Record<string, Scope | null> {
  return Object.fromEntries(
    PERMISSION_CATALOG.map((p) => [p.code, p.validScopes.includes(Scope.EMPRESA) ? Scope.EMPRESA : null]),
  );
}

function makeAuthz(
  callerGrants: Record<string, Scope | null> = fullCallerGrants(),
  profileGrants: Record<string, { permissionCode: string; scope: Scope | null }[]> = {},
) {
  return {
    getEffectivePermissions: jest.fn().mockResolvedValue(callerGrants),
    getProfileGrants: jest.fn((_companyId: string, profileId: string | null) =>
      Promise.resolve(profileId ? (profileGrants[profileId] ?? []) : []),
    ),
  } as any;
}

// Chamador padrão: ADMIN que JÁ tem acesso total ao Ponto — passa livremente pelo gate. Testes do
// gate em si passam `hasFullPontoAccess: false` ou `role: 'EMPLOYEE'`.
function makeCaller(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    userId: 'caller-1',
    companyId: 'company-1',
    role: 'ADMIN',
    modules: [],
    mustChangePassword: false,
    hasFullPontoAccess: true,
    permissions: {},
    ...overrides,
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
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

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
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(service.findOne('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('rejeita permissionCode desconhecido', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(
        service.create('company-1', { name: 'Teste', grants: [{ permissionCode: 'inexistente.foo', scope: null }] }, makeCaller()),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.profile.create).not.toHaveBeenCalled();
    });

    it('rejeita scope ausente numa permissão que exige scope', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(
        service.create('company-1', { name: 'Teste', grants: [{ permissionCode: 'clientes.ver', scope: null }] }, makeCaller()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita scope presente numa permissão sem validScopes', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(
        service.create('company-1', { name: 'Teste', grants: [{ permissionCode: 'dashboard.ver', scope: Scope.EMPRESA }] }, makeCaller()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejeita permissionCode duplicado na mesma lista', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(
        service.create('company-1', {
          name: 'Teste',
          grants: [
            { permissionCode: 'dashboard.ver', scope: null },
            { permissionCode: 'dashboard.ver', scope: null },
          ],
        }, makeCaller()),
      ).rejects.toThrow(BadRequestException);
    });

    it('cria o perfil com isProtected sempre false', async () => {
      const prisma = makePrisma();
      prisma.profile.create.mockResolvedValue({
        id: 'p2', name: 'Financeiro', isProtected: false,
        permissions: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }],
        _count: { users: 0 },
      });
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      const result = await service.create('company-1', {
        name: 'Financeiro',
        grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }],
      }, makeCaller());

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

    // `affectedUsers` aceita ids soltos (o caso antigo, sempre EMPLOYEE) ou objetos completos, pros
    // testes do acesso total ao Ponto, que dependem do `role` de cada afetado.
    function makeTxPrisma(
      profileId: string,
      affectedUsers: (string | { id: string; role: 'ADMIN' | 'EMPLOYEE' })[],
      currentGrants: unknown[] = [],
    ) {
      const tx = {
        $executeRaw: jest.fn(),
        // `update` além de `findMany`: a brief original só previa `findMany`, mas
        // `recomputeAndSaveUserAccess` (Task 2, código real) chama `tx.user.update(...)` pra
        // gravar `modules`/`hasFullPontoAccess` recalculados — sem isso o mock quebra com
        // "tx.user.update is not a function" assim que o loop de recálculo roda. Corrigido aqui
        // pra refletir o comportamento real da função já implementada, não uma expectativa
        // desatualizada da brief (mesma classe de ajuste já registrada na Task 2).
        user: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              affectedUsers.map((u) => (typeof u === 'string' ? { id: u, role: 'EMPLOYEE' } : u)),
            ),
          update: jest.fn(),
        },
        profilePermission: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
          // Grants ATUAIS do perfil sendo editado — lidos pelo service desde a revisão final da
          // branch (22/09/2026) pra (a) só rodar a trava de `usuarios.gerenciar` quando o perfil de
          // fato a concedia e (b) saber se ele dava acesso total ao Ponto.
          findMany: jest.fn().mockResolvedValue(currentGrants),
        },
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
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(service.update('company-1', 'p1', { name: 'X', grants: [] }, makeCaller())).rejects.toThrow(ForbiddenException);
    });

    it('lança NotFoundException se o perfil não existir na empresa', async () => {
      const { prisma } = makeTxPrisma('p1', []);
      (prisma.profile.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(service.update('company-1', 'p1', { name: 'X', grants: [] }, makeCaller())).rejects.toThrow(NotFoundException);
    });

    // Corrigido na rodada de revisão de segurança pós-implementação: a versão original chamava
    // `assertNotLastHolderOfPermission` uma vez POR USUÁRIO afetado, ANTES da reescrita em lote
    // das ProfilePermission — o que deixava passar um lote que zerava por completo os detentores
    // de `usuarios.gerenciar` da empresa quando TODOS os usuários de um perfil compartilhado
    // perdiam a permissão ao mesmo tempo (ver task-4-report.md, seção "Rodada de correção", pro
    // passo a passo completo). `assertOtherProfileGrantsPermission` substitui essa checagem por
    // UMA chamada só, por PERFIL sendo editado, não por usuário.
    it('chama assertOtherProfileGrantsPermission uma única vez, pelo PERFIL sendo editado, ao remover usuarios.gerenciar', async () => {
      const { prisma, tx } = makeTxPrisma('p1', ['u1', 'u2'], [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.update('company-1', 'p1', { name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] }, makeCaller());

      expect(assertOtherProfileGrantsPermission).toHaveBeenCalledTimes(1);
      expect(assertOtherProfileGrantsPermission).toHaveBeenCalledWith(tx, 'company-1', 'usuarios.gerenciar', 'p1');
    });

    // Achado menor da revisão final da branch (22/09/2026): a condição era só
    // `!willGrantUsuariosGerenciar`, sem olhar os grants ATUAIS — editar um perfil que nunca
    // concedeu `usuarios.gerenciar` (o caso comum) rodava a trava à toa e podia devolver um 400
    // confuso numa edição que não removia a permissão de ninguém.
    it('NÃO chama a trava quando o perfil nunca concedeu usuarios.gerenciar (nada está sendo removido)', async () => {
      const { prisma } = makeTxPrisma('p1', ['u1'], [{ permissionCode: 'dashboard.ver', scope: null }]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.update('company-1', 'p1', { name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] }, makeCaller());

      expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
    });

    it('NÃO chama a trava se a nova lista ainda concede usuarios.gerenciar', async () => {
      const { prisma } = makeTxPrisma('p1', ['u1']);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.update('company-1', 'p1', { name: 'Admin', grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }] }, makeCaller());

      expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
    });

    // Quem gerencia a assinatura (27/09/2026): tirar `assinatura.gerenciar` de um perfil passa pela
    // mesma trava por PERFIL — senão a empresa podia ficar sem ninguém para gerenciar o plano.
    it('chama assertOtherProfileGrantsPermission para assinatura.gerenciar ao removê-la do perfil', async () => {
      const { prisma, tx } = makeTxPrisma('p1', ['u1'], [
        { permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA },
        { permissionCode: 'assinatura.gerenciar', scope: null },
      ]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.update('company-1', 'p1', { name: 'Admin', grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }] }, makeCaller());

      expect(assertOtherProfileGrantsPermission).toHaveBeenCalledTimes(1);
      expect(assertOtherProfileGrantsPermission).toHaveBeenCalledWith(tx, 'company-1', 'assinatura.gerenciar', 'p1');
    });

    it('regrava as ProfilePermission e recalcula cada usuário afetado', async () => {
      const { prisma, tx } = makeTxPrisma('p1', ['u1', 'u2']);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.update('company-1', 'p1', { name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] }, makeCaller());

      expect(tx.profilePermission.deleteMany).toHaveBeenCalledWith({ where: { profileId: 'p1' } });
      expect(tx.profilePermission.createMany).toHaveBeenCalledWith({
        data: [{ companyId: 'company-1', profileId: 'p1', permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }],
      });
      expect(tx.profile.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { name: 'Financeiro' } });
      // Achado Important #2 da revisão final da branch (22/09/2026): SEM `status: 'ACTIVE'` — esta
      // lista alimenta a MUTAÇÃO (recálculo de modules/hasFullPontoAccess), não uma checagem. Um
      // holder BLOCKED/LOCKED ficava sem o recálculo e voltava com acesso desatualizado ao ser
      // desbloqueado depois.
      expect(tx.user.findMany).toHaveBeenCalledWith({ where: { profileId: 'p1' } });
    });

    it('recalcula TODO holder do perfil, inclusive um BLOCKED (não filtra por status)', async () => {
      const { prisma, tx } = makeTxPrisma('p1', [
        { id: 'ativo', role: 'EMPLOYEE' },
        { id: 'bloqueado', role: 'EMPLOYEE' },
      ]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.update('company-1', 'p1', { name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: Scope.EMPRESA }] }, makeCaller());

      expect(tx.user.update).toHaveBeenCalledTimes(2);
      const recomputedIds = (tx.user.update as jest.Mock).mock.calls.map((c) => c[0].where.id);
      expect(recomputedIds).toEqual(['ativo', 'bloqueado']);
    });

    // Achado Important #1 da revisão final da branch (22/09/2026): editar um Perfil COMPARTILHADO
    // por vários ADMINs podia derrubar `ponto.administrar` de EMPRESA pra algo menor e zerar de uma
    // vez o acesso total ao Ponto de todos eles — mesma classe de bug já corrigida aqui pra
    // `usuarios.gerenciar`, sem nenhuma checagem equivalente até agora.
    describe('acesso total ao Ponto (ponto.administrar@EMPRESA)', () => {
      const FULL_PONTO = [{ permissionCode: 'ponto.administrar', scope: Scope.EMPRESA }];
      const RESTRITO = [{ permissionCode: 'ponto.administrar', scope: Scope.EQUIPE }];

      it('BARRA (404) um ADMIN restrito rebaixando o acesso total de um perfil que admins usam', async () => {
        const { prisma } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], FULL_PONTO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await expect(
          service.update(
            'company-1',
            'p1',
            { name: 'Perfil', grants: RESTRITO },
            makeCaller({ hasFullPontoAccess: false }),
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('chama o invariante (excluindo o próprio perfil) quando um admin de acesso total faz o rebaixamento', async () => {
        const { prisma, tx } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], FULL_PONTO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await service.update('company-1', 'p1', { name: 'Perfil', grants: RESTRITO }, makeCaller());

        expect(assertOtherAdminGrantsFullPontoAccess).toHaveBeenCalledTimes(1);
        expect(assertOtherAdminGrantsFullPontoAccess).toHaveBeenCalledWith(tx, 'company-1', 'p1');
      });

      it('trata REMOVER ponto.administrar por completo como rebaixamento (não só trocar o scope)', async () => {
        const { prisma, tx } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], FULL_PONTO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await service.update('company-1', 'p1', { name: 'Perfil', grants: [] }, makeCaller());

        expect(assertOtherAdminGrantsFullPontoAccess).toHaveBeenCalledWith(tx, 'company-1', 'p1');
      });

      it('NÃO checa nada quando nenhum dos afetados é ADMIN (EMPLOYEE nunca tem acesso total)', async () => {
        const { prisma } = makeTxPrisma('p1', [{ id: 'e1', role: 'EMPLOYEE' }], FULL_PONTO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await service.update(
          'company-1',
          'p1',
          { name: 'Perfil', grants: RESTRITO },
          makeCaller({ hasFullPontoAccess: false }),
        );

        expect(assertOtherAdminGrantsFullPontoAccess).not.toHaveBeenCalled();
      });

      it('NÃO checa nada quando o perfil continua concedendo ponto.administrar@EMPRESA', async () => {
        const { prisma } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], FULL_PONTO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await service.update(
          'company-1',
          'p1',
          { name: 'Perfil', grants: FULL_PONTO },
          makeCaller({ hasFullPontoAccess: false }),
        );

        expect(assertOtherAdminGrantsFullPontoAccess).not.toHaveBeenCalled();
      });

      // Sem MUDANÇA de acesso total (EQUIPE → nenhum é `false` → `false`): nem gate nem invariante.
      // Um chamador restrito passando sem lançar É a asserção de que o gate não disparou.
      it('NÃO checa nada quando o acesso total não muda (já não dava antes, continua sem dar)', async () => {
        const { prisma } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], RESTRITO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await service.update(
          'company-1',
          'p1',
          { name: 'Perfil', grants: [] },
          makeCaller({ hasFullPontoAccess: false }),
        );

        expect(assertOtherAdminGrantsFullPontoAccess).not.toHaveBeenCalled();
      });

      // Achado CRÍTICO da re-revisão (22/09/2026): o gate só olhava o sentido do REBAIXAMENTO, e o
      // exploit real passava pelo sentido oposto. `ProfilesController` é `@Roles('ADMIN')` e nada
      // mais; o perfil de um ADMIN restrito é `isProtected: false` — ele editava o PRÓPRIO perfil
      // adicionando `ponto.administrar@EMPRESA` e, como `currentlyGrantsFullPonto` era `false`, a
      // condição inteira dava `false` e NENHUMA checagem rodava. Depois do
      // `recomputeAndSaveUserAccess`, o `hasFullPontoAccess` dele virava `true`.
      it('BARRA (404) um ADMIN restrito CONCEDENDO acesso total (a escalação pelo sentido oposto)', async () => {
        const { prisma } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], RESTRITO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await expect(
          service.update(
            'company-1',
            'p1',
            { name: 'Perfil', grants: FULL_PONTO },
            makeCaller({ hasFullPontoAccess: false }),
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('BARRA (404) a concessão mesmo partindo de um perfil que não tinha ponto.administrar nenhum', async () => {
        const { prisma } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], []);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await expect(
          service.update(
            'company-1',
            'p1',
            { name: 'Perfil', grants: FULL_PONTO },
            makeCaller({ hasFullPontoAccess: false }),
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('PERMITE a concessão quando o chamador já tem acesso total, sem acionar o invariante', async () => {
        const { prisma } = makeTxPrisma('p1', [{ id: 'a1', role: 'ADMIN' }], RESTRITO);
        const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

        await service.update('company-1', 'p1', { name: 'Perfil', grants: FULL_PONTO }, makeCaller());

        // Conceder nunca pode zerar a contagem — o invariante não tem o que checar aqui.
        expect(assertOtherAdminGrantsFullPontoAccess).not.toHaveBeenCalled();
      });
    });
  });
});

describe('remove', () => {
  it('lança ForbiddenException se o perfil for protegido', async () => {
    const prisma = {
      profile: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: true, _count: { users: 0 } }) },
    };
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await expect(service.remove('company-1', 'p1', makeCaller())).rejects.toThrow(ForbiddenException);
  });

  it('lança NotFoundException se o perfil não existir na empresa', async () => {
    const prisma = { profile: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await expect(service.remove('company-1', 'missing', makeCaller())).rejects.toThrow(NotFoundException);
  });

  it('lança BadRequestException se o perfil ainda estiver em uso', async () => {
    const prisma = {
      profile: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: false, _count: { users: 3 } }) },
    };
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await expect(service.remove('company-1', 'p1', makeCaller())).rejects.toThrow(BadRequestException);
  });

  it('exclui um perfil não-protegido sem usuários', async () => {
    const prisma = {
      profile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: false, _count: { users: 0 } }),
        delete: jest.fn(),
      },
    };
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.remove('company-1', 'p1', makeCaller());

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
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await expect(
      service.reassignAndDelete('company-1', 'p1', { targetProfileId: 'p1' }, makeCaller()),
    ).rejects.toThrow(BadRequestException);
  });

  it('lança NotFoundException se a origem não existir na empresa', async () => {
    const prisma = {
      profile: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'target' }) },
    };
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await expect(
      service.reassignAndDelete('company-1', 'missing', { targetProfileId: 'target' }, makeCaller()),
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
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await expect(
      service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller()),
    ).rejects.toThrow(ForbiddenException);
  });

  // Task 6, fix round 1: mover logins pro perfil protegido (Administrador Geral) é atribuí-lo, a
  // mesma regra de UsersService.create()/assignProfile(): só um chamador ADMIN.
  it('lança 403 PERMISSION_REQUIRED se um chamador não ADMIN reatribuir para o perfil protegido, sem transação', async () => {
    const prisma = {
      profile: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'source', isProtected: false })
          .mockResolvedValueOnce({ id: 'target', name: 'Administrador Geral', isProtected: true }),
      },
      $transaction: jest.fn(),
    };
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    const err = await service
      .reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller({ role: 'EMPLOYEE', hasFullPontoAccess: false }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toEqual({
      statusCode: 403,
      code: 'PERMISSION_REQUIRED',
      message: 'Só um administrador pode atribuir o perfil Administrador Geral.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('permite a um chamador ADMIN reatribuir para o perfil protegido', async () => {
    const { prisma, tx } = makeTxPrisma();
    prisma.profile.findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'source', isProtected: false })
      .mockResolvedValueOnce({ id: 'target', name: 'Administrador Geral', isProtected: true });
    tx.profilePermission.findMany.mockResolvedValue([]);
    tx.user.findMany.mockResolvedValue([]);
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());
    expect(tx.profile.delete).toHaveBeenCalledWith({ where: { id: 'source' } });
  });

  it('lança NotFoundException se o destino não existir na empresa', async () => {
    const prisma = {
      profile: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 'source', isProtected: false }).mockResolvedValueOnce(null),
      },
    };
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await expect(
      service.reassignAndDelete('company-1', 'source', { targetProfileId: 'missing' }, makeCaller()),
    ).rejects.toThrow(NotFoundException);
  });

  it('reatribui cada usuário sequencialmente e exclui o perfil de origem', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());

    expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
    expect(reassignUserProfile).toHaveBeenNthCalledWith(1, tx, 'u1', 'target');
    expect(reassignUserProfile).toHaveBeenNthCalledWith(2, tx, 'u2', 'target');
    expect(tx.profile.delete).toHaveBeenCalledWith({ where: { id: 'source' } });
    // Achado Important #2 da revisão final da branch (22/09/2026): SEM `status: 'ACTIVE'` — esta
    // lista alimenta a MUTAÇÃO (mover cada login antes de apagar o perfil). Com o filtro, um holder
    // BLOCKED/LOCKED era deixado pra trás e virava órfão (`profileId: null`, via o `onDelete:
    // SetNull` da FK) no `profile.delete` logo em seguida.
    expect(tx.user.findMany).toHaveBeenCalledWith({ where: { profileId: 'source' } });
  });

  it('move TODO holder do perfil de origem, inclusive um BLOCKED (não filtra por status)', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    tx.user.findMany.mockResolvedValue([{ id: 'ativo' }, { id: 'bloqueado' }]);
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());

    expect(reassignUserProfile).toHaveBeenCalledTimes(2);
    expect(reassignUserProfile).toHaveBeenNthCalledWith(2, tx, 'bloqueado', 'target');
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
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());

    expect(assertOtherProfileGrantsPermission).toHaveBeenCalledTimes(1);
    expect(assertOtherProfileGrantsPermission).toHaveBeenCalledWith(tx, 'company-1', 'usuarios.gerenciar', 'source');
  });

  it('chama a trava para assinatura.gerenciar se a origem a concede e o destino não', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany
      .mockResolvedValueOnce([{ permissionCode: 'assinatura.gerenciar' }])
      .mockResolvedValueOnce([]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());

    expect(assertOtherProfileGrantsPermission).toHaveBeenCalledTimes(1);
    expect(assertOtherProfileGrantsPermission).toHaveBeenCalledWith(tx, 'company-1', 'assinatura.gerenciar', 'source');
  });

  it('NÃO chama a trava se o destino também concede usuarios.gerenciar', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany
      .mockResolvedValueOnce([{ permissionCode: 'usuarios.gerenciar' }])
      .mockResolvedValueOnce([{ permissionCode: 'usuarios.gerenciar' }]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());

    expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
  });

  it('NÃO chama a trava se o destino não concede a permissão mas a origem também não concedia', async () => {
    const { prisma, tx } = makeTxPrisma();
    tx.profilePermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    tx.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

    await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());

    expect(assertOtherProfileGrantsPermission).not.toHaveBeenCalled();
  });

  // A brief da revisão final marcava esta proteção como OPCIONAL aqui — adicionada porque
  // reatribuir-e-excluir é um TERCEIRO caminho capaz de mudar o acesso total ao Ponto de um ADMIN,
  // inclusive na direção perigosa (um ADMIN restrito excluindo o PRÓPRIO perfil restrito e se
  // reatribuindo ao perfil de acesso total — a mesma escalação que `assignProfile()` passou a
  // barrar). Mesmo par gate+invariante de `update()`.
  describe('acesso total ao Ponto (ponto.administrar@EMPRESA)', () => {
    const FULL_PONTO = [{ permissionCode: 'ponto.administrar', scope: Scope.EMPRESA }];
    const RESTRITO = [{ permissionCode: 'ponto.administrar', scope: Scope.EQUIPE }];

    it('BARRA (404) um ADMIN restrito se reatribuindo pro perfil de acesso total — a escalação lateral', async () => {
      const { prisma, tx } = makeTxPrisma();
      tx.profilePermission.findMany.mockResolvedValueOnce(RESTRITO).mockResolvedValueOnce(FULL_PONTO);
      tx.user.findMany.mockResolvedValue([{ id: 'a1', role: 'ADMIN' }]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await expect(
        service.reassignAndDelete(
          'company-1',
          'source',
          { targetProfileId: 'target' },
          makeCaller({ hasFullPontoAccess: false }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('chama o invariante (excluindo o perfil de ORIGEM) ao mover admins de acesso total pra um destino sem ele', async () => {
      const { prisma, tx } = makeTxPrisma();
      tx.profilePermission.findMany.mockResolvedValueOnce(FULL_PONTO).mockResolvedValueOnce(RESTRITO);
      tx.user.findMany.mockResolvedValue([{ id: 'a1', role: 'ADMIN' }]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller());

      expect(assertOtherAdminGrantsFullPontoAccess).toHaveBeenCalledTimes(1);
      expect(assertOtherAdminGrantsFullPontoAccess).toHaveBeenCalledWith(tx, 'company-1', 'source');
    });

    it('NÃO checa nada quando nenhum dos afetados é ADMIN', async () => {
      const { prisma, tx } = makeTxPrisma();
      tx.profilePermission.findMany.mockResolvedValueOnce(FULL_PONTO).mockResolvedValueOnce(RESTRITO);
      tx.user.findMany.mockResolvedValue([{ id: 'e1', role: 'EMPLOYEE' }]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.reassignAndDelete(
        'company-1',
        'source',
        { targetProfileId: 'target' },
        makeCaller({ hasFullPontoAccess: false }),
      );

      expect(assertOtherAdminGrantsFullPontoAccess).not.toHaveBeenCalled();
    });

    it('NÃO checa nada quando origem e destino dão o mesmo acesso total', async () => {
      const { prisma, tx } = makeTxPrisma();
      tx.profilePermission.findMany.mockResolvedValueOnce(FULL_PONTO).mockResolvedValueOnce(FULL_PONTO);
      tx.user.findMany.mockResolvedValue([{ id: 'a1', role: 'ADMIN' }]);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz());

      await service.reassignAndDelete(
        'company-1',
        'source',
        { targetProfileId: 'target' },
        makeCaller({ hasFullPontoAccess: false }),
      );

      expect(assertOtherAdminGrantsFullPontoAccess).not.toHaveBeenCalled();
    });
  });
});

// Concessão limitada (28/09/2026): quem gerencia acessos só concede o que o próprio perfil também
// tem — o poder do chamador é lido do BANCO, e vale pra todo papel (sem exceção de ADMIN).
describe('concessão limitada (no-escalation)', () => {
  const GRANT_MSG = (labels: string) => `Você só pode dar permissões que o seu próprio perfil também tem: ${labels}.`;
  const PROFILE_MSG = 'Este perfil tem permissões que o seu perfil não tem. Só quem tem todas elas pode alterá-lo.';

  // Chamador "gerente de RH": gerencia usuários, vê funcionários só do time, sem pagamentos.
  const LIMITED_CALLER: Record<string, Scope | null> = {
    'usuarios.gerenciar': Scope.EMPRESA,
    'funcionarios.ver': Scope.EQUIPE,
    'dashboard.ver': null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function expectPermissionRequired(promise: Promise<unknown>, message: string) {
    const err: any = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toEqual({ statusCode: 403, code: 'PERMISSION_REQUIRED', message });
  }

  describe('create', () => {
    it('recusa (403) grants fora do poder do chamador, listando os rótulos, sem criar nada', async () => {
      const prisma = makePrisma();
      const authz = makeAuthz(LIMITED_CALLER);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), authz);

      await expectPermissionRequired(
        service.create('company-1', {
          name: 'Gerente',
          grants: [
            { permissionCode: 'funcionarios.ver', scope: Scope.EMPRESA },
            { permissionCode: 'dashboard.ver', scope: null },
            { permissionCode: 'pagamentos.gerenciar', scope: Scope.EQUIPE },
          ],
        }, makeCaller({ userId: 'caller-x' })),
        GRANT_MSG('Ver Funcionários, Gerenciar pagamentos de Funcionários'),
      );
      expect(authz.getEffectivePermissions).toHaveBeenCalledWith('caller-x');
      expect(prisma.profile.create).not.toHaveBeenCalled();
    });

    it('recusa mesmo um chamador de papel ADMIN (sem exceção por papel)', async () => {
      const prisma = makePrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER));

      await expectPermissionRequired(
        service.create('company-1', { name: 'X', grants: [{ permissionCode: 'clientes.ver', scope: Scope.EMPRESA }] }, makeCaller({ role: 'ADMIN' })),
        GRANT_MSG('Ver Clientes'),
      );
      expect(prisma.profile.create).not.toHaveBeenCalled();
    });

    it('permite grants dentro do poder do chamador', async () => {
      const prisma = makePrisma();
      prisma.profile.create.mockResolvedValue({ id: 'p9', name: 'Time', isProtected: false, permissions: [], _count: { users: 0 } });
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER));

      await service.create('company-1', {
        name: 'Time',
        grants: [{ permissionCode: 'funcionarios.ver', scope: Scope.EQUIPE }, { permissionCode: 'dashboard.ver', scope: null }],
      }, makeCaller({ role: 'EMPLOYEE' }));
      expect(prisma.profile.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    function makeUpdatePrisma() {
      const tx = {
        $executeRaw: jest.fn(),
        user: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
        profilePermission: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        profile: { update: jest.fn() },
      };
      const prisma = {
        profile: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: false, permissions: [], _count: { users: 0 } }) },
        $transaction: jest.fn((cb: any) => cb(tx)),
      };
      return { prisma, tx };
    }

    it('recusa (403) editar um perfil cujos grants ATUAIS estão acima do chamador, sem transação', async () => {
      const { prisma } = makeUpdatePrisma();
      const authz = makeAuthz(LIMITED_CALLER, { p1: [{ permissionCode: 'pagamentos.gerenciar', scope: Scope.EMPRESA }] });
      const service = new ProfilesService(prisma as any, makeTimeAuth(), authz);

      await expectPermissionRequired(
        service.update('company-1', 'p1', { name: 'X', grants: [{ permissionCode: 'dashboard.ver', scope: null }] }, makeCaller()),
        PROFILE_MSG,
      );
      expect(authz.getProfileGrants).toHaveBeenCalledWith('company-1', 'p1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa (403) uma nova lista de grants acima do chamador, listando os rótulos, sem transação', async () => {
      const { prisma } = makeUpdatePrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER, { p1: [{ permissionCode: 'dashboard.ver', scope: null }] }));

      await expectPermissionRequired(
        service.update('company-1', 'p1', { name: 'X', grants: [{ permissionCode: 'funcionarios.ver', scope: Scope.DEPARTAMENTO }] }, makeCaller()),
        GRANT_MSG('Ver Funcionários'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('perfil protegido continua com o 403 de sempre, antes da checagem de poder', async () => {
      const { prisma } = makeUpdatePrisma();
      prisma.profile.findFirst.mockResolvedValue({ id: 'p1', isProtected: true });
      const authz = makeAuthz(LIMITED_CALLER);
      const service = new ProfilesService(prisma as any, makeTimeAuth(), authz);

      await expect(service.update('company-1', 'p1', { name: 'X', grants: [] }, makeCaller())).rejects.toThrow(
        'Este perfil é protegido e não pode ser editado',
      );
      expect(authz.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('permite quando perfil atual e nova lista estão dentro do chamador', async () => {
      const { prisma, tx } = makeUpdatePrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER, { p1: [{ permissionCode: 'funcionarios.ver', scope: Scope.EQUIPE }] }));

      await service.update('company-1', 'p1', { name: 'X', grants: [{ permissionCode: 'dashboard.ver', scope: null }] }, makeCaller());
      expect(tx.profilePermission.createMany).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('recusa (403) excluir um perfil acima do chamador, sem excluir', async () => {
      const prisma = {
        profile: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isProtected: false, _count: { users: 0 } }), delete: jest.fn() },
      };
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER, { p1: [{ permissionCode: 'clientes.gerenciar', scope: Scope.EMPRESA }] }));

      await expectPermissionRequired(service.remove('company-1', 'p1', makeCaller()), PROFILE_MSG);
      expect(prisma.profile.delete).not.toHaveBeenCalled();
    });
  });

  describe('reassignAndDelete', () => {
    function makeReassignPrisma() {
      const tx = {
        $executeRaw: jest.fn(),
        profilePermission: { findMany: jest.fn().mockResolvedValue([]) },
        user: { findMany: jest.fn().mockResolvedValue([]) },
        profile: { delete: jest.fn() },
      };
      const prisma = {
        profile: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: 'source', isProtected: false })
            .mockResolvedValueOnce({ id: 'target', name: 'Destino', isProtected: false }),
        },
        $transaction: jest.fn((cb: any) => cb(tx)),
      };
      return { prisma, tx };
    }

    it('recusa (403) quando o perfil de ORIGEM está acima do chamador, sem transação', async () => {
      const { prisma } = makeReassignPrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER, { source: [{ permissionCode: 'cargos.gerenciar', scope: Scope.EMPRESA }] }));

      await expectPermissionRequired(
        service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller()),
        PROFILE_MSG,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('recusa (403) quando o perfil de DESTINO está acima do chamador, listando os rótulos, sem transação', async () => {
      const { prisma } = makeReassignPrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER, { target: [{ permissionCode: 'ferias.gerenciar', scope: Scope.EQUIPE }] }));

      await expectPermissionRequired(
        service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller()),
        GRANT_MSG('Agendar/cancelar Férias e Afastamentos'),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('permite quando origem e destino estão dentro do chamador', async () => {
      const { prisma, tx } = makeReassignPrisma();
      const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(LIMITED_CALLER, {
        source: [{ permissionCode: 'dashboard.ver', scope: null }],
        target: [{ permissionCode: 'funcionarios.ver', scope: Scope.EQUIPE }],
      }));

      await service.reassignAndDelete('company-1', 'source', { targetProfileId: 'target' }, makeCaller({ role: 'EMPLOYEE', hasFullPontoAccess: false }));
      expect(tx.profile.delete).toHaveBeenCalledWith({ where: { id: 'source' } });
    });
  });

  it('um chamador tipo Administrador Geral passa por toda checagem de poder', async () => {
    const everything = PERMISSION_CATALOG.map((p) => ({
      permissionCode: p.code,
      scope: p.validScopes.includes(Scope.EMPRESA) ? Scope.EMPRESA : null,
    }));
    const prisma = makePrisma();
    prisma.profile.create.mockResolvedValue({ id: 'p9', name: 'Tudo', isProtected: false, permissions: [], _count: { users: 0 } });
    const service = new ProfilesService(prisma as any, makeTimeAuth(), makeAuthz(undefined, { p1: everything }));

    await service.create('company-1', { name: 'Tudo', grants: everything }, makeCaller());
    expect(prisma.profile.create).toHaveBeenCalled();
  });
});
