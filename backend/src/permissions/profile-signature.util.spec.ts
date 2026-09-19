import { Scope } from '@prisma/client';
import { PERMISSION_CATALOG } from './permission-catalog';
import {
  computeProfileSignature,
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
    expect(codesOf(result)).toEqual(['campos-personalizados.gerenciar', 'dashboard.ver', 'usuarios.gerenciar']);
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
    expect(getRoleOnlyGatedPermissionCodes().sort()).toEqual(['campos-personalizados.gerenciar', 'usuarios.gerenciar']);
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

  it('reaproveita um perfil homônimo já existente na empresa, sem criar outro', async () => {
    const tx = {
      profile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'profile-existente' }),
        create: jest.fn(),
      },
    };
    const id = await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    expect(id).toBe('profile-existente');
    expect(tx.profile.findFirst).toHaveBeenCalledWith({ where: { companyId: 'company-1', name: 'Administrador Geral' } });
    expect(tx.profile.create).not.toHaveBeenCalled();
  });

  it('cria o perfil com os grants da assinatura quando não existe nenhum homônimo', async () => {
    const tx = {
      profile: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'profile-novo' }),
      },
    };
    const id = await getOrCreateProfileForSignature(tx as any, 'company-1', signature);
    expect(id).toBe('profile-novo');
    expect(tx.profile.create).toHaveBeenCalledWith({
      data: {
        companyId: 'company-1',
        name: 'Administrador Geral',
        isProtected: true,
        permissions: { create: [{ companyId: 'company-1', permissionCode: 'usuarios.gerenciar', scope: Scope.EMPRESA }] },
      },
    });
  });
});
