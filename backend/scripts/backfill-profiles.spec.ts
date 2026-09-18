import { Scope } from '@prisma/client';
import { computeProfileSignature, ProfileSignature } from './backfill-profiles';

type Grant = ProfileSignature['grants'][number];

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
});
