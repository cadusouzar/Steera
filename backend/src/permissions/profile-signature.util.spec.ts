import { Scope } from '@prisma/client';
import { PERMISSION_CATALOG } from './permission-catalog';
import {
  computeProfileSignature,
  deriveHasFullPontoAccessFromGrants,
  deriveModulesFromGrants,
  getOrCreateProfileForSignature,
  getRoleOnlyGatedPermissionCodes,
  MODULE_TO_PERMISSIONS,
  ProfileSignature,
} from './profile-signature.util';

type Grant = ProfileSignature['grants'][number];
const codesOf = (s: ProfileSignature) => s.grants.map((g: Grant) => g.permissionCode).sort();

describe('computeProfileSignature', () => {
  it('ADMIN com hasFullPontoAccess=true vira "Administrador Geral" protegido, tudo em EMPRESA', () => {
    const result = computeProfileSignature({ role: 'ADMIN', modules: ['DASHBOARD', 'PONTO_ADMINISTRACAO'], hasFullPontoAccess: true });
    expect(result.name).toBe('Administrador Geral');
    expect(result.isProtected).toBe(true);
    const ponto = result.grants.find((g: Grant) => g.permissionCode === 'ponto.administrar');
    expect(ponto?.scope).toBe(Scope.EMPRESA);
  });

  it('ADMIN com hasFullPontoAccess=false: tudo em EMPRESA exceto ponto.administrar, que vira EQUIPE', () => {
    const result = computeProfileSignature({ role: 'ADMIN', modules: ['DASHBOARD', 'PONTO_ADMINISTRACAO'], hasFullPontoAccess: false });
    expect(result.name).toBe('Administrador Geral (restrito ao Ponto)');
    expect(result.isProtected).toBe(false);
    const ponto = result.grants.find((g: Grant) => g.permissionCode === 'ponto.administrar');
    expect(ponto?.scope).toBe(Scope.EQUIPE);
    const dashboard = result.grants.find((g: Grant) => g.permissionCode === 'dashboard.ver');
    expect(dashboard).toBeDefined();
  });

  it('EMPLOYEE com um módulo: perfil "Legado" com só as permissões daquele módulo, tudo EMPRESA', () => {
    const result = computeProfileSignature({ role: 'EMPLOYEE', modules: ['PONTO_REGISTRO'], hasFullPontoAccess: true });
    expect(result.isProtected).toBe(false);
    expect(result.name).toBe('Legado: PONTO_REGISTRO');
    expect(result.grants).toEqual([{ permissionCode: 'ponto.registrar', scope: null }]);
  });

  it('EMPLOYEE com PONTO_ADMINISTRACAO: ponto.administrar vira EMPRESA no perfil (só declarativo — TimeManagementAuthService continua restringindo de verdade)', () => {
    const result = computeProfileSignature({ role: 'EMPLOYEE', modules: ['PONTO_ADMINISTRACAO'], hasFullPontoAccess: false });
    const ponto = result.grants.find((g: Grant) => g.permissionCode === 'ponto.administrar');
    expect(ponto?.scope).toBe(Scope.EMPRESA);
  });

  it('dois EMPLOYEE com os mesmos modules mas hasFullPontoAccess cru diferente geram a MESMA assinatura (effective, não cru)', () => {
    const a = computeProfileSignature({ role: 'EMPLOYEE', modules: ['DASHBOARD'], hasFullPontoAccess: true });
    const b = computeProfileSignature({ role: 'EMPLOYEE', modules: ['DASHBOARD'], hasFullPontoAccess: false });
    expect(a).toEqual(b);
  });

  // ————— Regressão-alvo da revisão final (I3): os dois ramos de ADMIN concediam o catálogo
  // INTEIRO, ignorando `modules` por completo.
  it('ADMIN de módulos restritos NÃO recebe o catálogo inteiro — só os módulos dele + os códigos gated só por papel', () => {
    const result = computeProfileSignature({ role: 'ADMIN', modules: ['DASHBOARD'], hasFullPontoAccess: true });
    // `assinatura.gerenciar` (27/09/2026) também não vem de módulo nenhum — é uma ação de ADMIN.
    expect(codesOf(result)).toEqual(['assinatura.gerenciar', 'campos-personalizados.gerenciar', 'dashboard.ver', 'usuarios.gerenciar']);
    expect(codesOf(result).length).toBeLessThan(PERMISSION_CATALOG.length);
    // Nada de Clientes/Finanças/Ponto vindo de graça.
    expect(codesOf(result)).not.toContain('clientes.ver');
    expect(codesOf(result)).not.toContain('financas.lancamentos.gerenciar');
    expect(codesOf(result)).not.toContain('ponto.administrar');
  });

  it('ADMIN com PONTO_ADMINISTRACAO recebe ponto.administrar E ponto.feriados.gerenciar', () => {
    const result = computeProfileSignature({ role: 'ADMIN', modules: ['PONTO_ADMINISTRACAO'], hasFullPontoAccess: true });
    expect(codesOf(result)).toContain('ponto.administrar');
    // HolidaysController exige @RequireModule('PONTO_ADMINISTRACAO') + @Roles('ADMIN'): sem esta
    // entrada no mapa, intersectar os grants de ADMIN com os módulos removeria o acesso a feriados.
    expect(codesOf(result)).toContain('ponto.feriados.gerenciar');
  });

  it('ADMIN com TODOS os módulos continua recebendo o catálogo inteiro (sem regressão pro fundador)', () => {
    const result = computeProfileSignature({
      role: 'ADMIN',
      modules: Object.keys(MODULE_TO_PERMISSIONS),
      hasFullPontoAccess: true,
    });
    expect(codesOf(result)).toEqual(PERMISSION_CATALOG.map((p) => p.code).sort());
  });

  it('EMPLOYEE nunca recebe os códigos gated só por papel, por mais módulos que tenha', () => {
    const result = computeProfileSignature({
      role: 'EMPLOYEE',
      modules: Object.keys(MODULE_TO_PERMISSIONS),
      hasFullPontoAccess: true,
    });
    expect(codesOf(result)).not.toContain('usuarios.gerenciar');
    expect(codesOf(result)).not.toContain('campos-personalizados.gerenciar');
  });
});

describe('getRoleOnlyGatedPermissionCodes', () => {
  it('devolve exatamente os códigos do catálogo que nenhum módulo concede', () => {
    expect(getRoleOnlyGatedPermissionCodes().sort()).toEqual(['assinatura.gerenciar', 'campos-personalizados.gerenciar', 'usuarios.gerenciar']);
  });

  it('todo código do mapa existe de verdade no catálogo (protege contra typo silencioso)', () => {
    const catalogCodes = new Set(PERMISSION_CATALOG.map((p) => p.code));
    for (const codes of Object.values(MODULE_TO_PERMISSIONS)) {
      for (const code of codes) expect(catalogCodes.has(code)).toBe(true);
    }
  });
});

describe('getOrCreateProfileForSignature', () => {
  const signature: ProfileSignature = {
    name: 'Administrador Geral',
    isProtected: true,
    grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }],
  };

  // Simula o banco: perfis por (companyId, name) com seus grants, para exercitar o laço de
  // desambiguação de verdade em vez de mockar cada chamada individualmente.
  function makeTx(seed: { id: string; name: string; grants: { permissionCode: string; scope: Scope | null }[] }[] = []) {
    const profiles = [...seed];
    let nextId = 1;
    return {
      profiles,
      profile: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(profiles.find((p) => p.name === where.name) ?? null),
        ),
        create: jest.fn(({ data }: any) => {
          const created = {
            id: `profile-criado-${nextId++}`,
            name: data.name,
            grants: data.permissions.create.map((g: any) => ({ permissionCode: g.permissionCode, scope: g.scope })),
          };
          profiles.push(created);
          return Promise.resolve(created);
        }),
      },
      profilePermission: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(profiles.find((p) => p.id === where.profileId)?.grants ?? []),
        ),
      },
    };
  }

  it('(a) mesmo nome + MESMOS grants: reaproveita o perfil existente, sem criar outro', async () => {
    const tx = makeTx([
      { id: 'profile-existente', name: 'Administrador Geral', grants: [{ permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }] },
    ]);
    const id = await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    expect(id).toBe('profile-existente');
    expect(tx.profile.findFirst).toHaveBeenCalledWith({ where: { companyId: 'company-1', name: 'Administrador Geral' } });
    expect(tx.profile.create).not.toHaveBeenCalled();
  });

  it('reaproveita mesmo com os grants na ORDEM diferente (comparação por conjunto, não por posição)', async () => {
    const multi: ProfileSignature = {
      name: 'Administrador Geral',
      isProtected: true,
      grants: [
        { permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA },
        { permissionCode: 'dashboard.ver', scope: null },
      ],
    };
    const tx = makeTx([
      {
        id: 'profile-existente',
        name: 'Administrador Geral',
        grants: [
          { permissionCode: 'dashboard.ver', scope: null },
          { permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA },
        ],
      },
    ]);
    expect(await getOrCreateProfileForSignature(tx as any, 'company-1', multi)).toBe('profile-existente');
    expect(tx.profile.create).not.toHaveBeenCalled();
  });

  it('cria o perfil com os grants da assinatura quando não existe nenhum homônimo', async () => {
    const tx = makeTx();
    const id = await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    expect(id).toBe('profile-criado-1');
    expect(tx.profile.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        name: 'Administrador Geral',
        isProtected: true,
        permissions: { create: [{ companyId: 'company-1', permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }] },
      },
    });
  });

  // Regressão-alvo da 2ª rodada de fixes: o perfil do fundador (catálogo inteiro) NÃO pode ser
  // reaproveitado por um admin restrito só porque a assinatura dele gera o mesmo nome.
  it('(b) mesmo nome + grants DIFERENTES: cria um perfil NOVO com nome desambiguado, nunca reaproveita', async () => {
    const tx = makeTx([
      {
        id: 'profile-fundador',
        name: 'Administrador Geral',
        grants: [
          { permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA },
          { permissionCode: 'clientes.gerenciar', scope: Scope.EMPRESA },
        ],
      },
    ]);
    const id = await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    expect(id).not.toBe('profile-fundador');
    expect(tx.profile.create).toHaveBeenCalledTimes(1);
    const created = tx.profile.create.mock.calls[0][0];
    expect(created.data.name).toBe('Administrador Geral (2)');
    expect(created.data.permissions.create).toEqual([
      { companyId: 'company-1', permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA },
    ]);
  });

  it('(c) a MESMA assinatura restrita chamada de novo reaproveita o perfil já desambiguado, não cria um terceiro', async () => {
    const tx = makeTx([
      {
        id: 'profile-fundador',
        name: 'Administrador Geral',
        grants: [
          { permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA },
          { permissionCode: 'clientes.gerenciar', scope: Scope.EMPRESA },
        ],
      },
    ]);
    const first = await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    const second = await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    expect(second).toBe(first);
    expect(tx.profile.create).toHaveBeenCalledTimes(1);
    expect(tx.profiles).toHaveLength(2); // fundador + o desambiguado, nunca um terceiro
  });

  it('uma TERCEIRA assinatura distinta sob o mesmo nome continua incrementando o sufixo', async () => {
    const tx = makeTx([
      { id: 'profile-fundador', name: 'Administrador Geral', grants: [{ permissionCode: 'clientes.gerenciar', scope: Scope.EMPRESA }] },
    ]);
    await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    const outra: ProfileSignature = {
      name: 'Administrador Geral',
      isProtected: true,
      grants: [{ permissionCode: 'dashboard.ver', scope: null }],
    };
    await getOrCreateProfileForSignature(tx as any, 'company-1', outra);
    expect(tx.profile.create.mock.calls.map((c: any[]) => c[0].data.name)).toEqual([
      'Administrador Geral (2)',
      'Administrador Geral (3)',
    ]);
  });
});

describe('deriveModulesFromGrants', () => {
  it('inclui um módulo se o perfil concede QUALQUER permissão daquele módulo', () => {
    const result = deriveModulesFromGrants([{ permissionCode: 'funcionarios.ver' }]);
    expect(result).toEqual(['RH_FUNCIONARIOS']);
  });

  it('combina módulos de várias permissões sem duplicar', () => {
    const result = deriveModulesFromGrants([
      { permissionCode: 'funcionarios.ver' },
      { permissionCode: 'funcionarios.gerenciar' },
      { permissionCode: 'ponto.administrar' },
    ]);
    expect(result.sort()).toEqual(['PONTO_ADMINISTRACAO', 'RH_FUNCIONARIOS'].sort());
  });

  it('nunca inclui RH (lista vazia no mapa)', () => {
    const result = deriveModulesFromGrants([{ permissionCode: 'usuarios.gerenciar' }]);
    expect(result).not.toContain('RH');
  });

  it('devolve lista vazia sem nenhum grant', () => {
    expect(deriveModulesFromGrants([])).toEqual([]);
  });

  it('ignora um permissionCode que não corresponde a nenhum módulo', () => {
    const result = deriveModulesFromGrants([{ permissionCode: 'usuarios.gerenciar' }]);
    expect(result).toEqual([]);
  });
});

describe('deriveHasFullPontoAccessFromGrants', () => {
  it('true quando ponto.administrar tem scope EMPRESA', () => {
    expect(deriveHasFullPontoAccessFromGrants([{ permissionCode: 'ponto.administrar', scope: Scope.EMPRESA }])).toBe(true);
  });

  it('false quando ponto.administrar tem scope EQUIPE', () => {
    expect(deriveHasFullPontoAccessFromGrants([{ permissionCode: 'ponto.administrar', scope: Scope.EQUIPE }])).toBe(false);
  });

  it('false quando não há grant de ponto.administrar', () => {
    expect(deriveHasFullPontoAccessFromGrants([])).toBe(false);
  });
});
