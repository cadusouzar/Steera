import { Scope } from '@prisma/client';
import { findUncoveredGrants, permissionLabels } from './grant-coverage.util';

describe('findUncoveredGrants', () => {
  it('EMPRESA do chamador cobre EQUIPE, PROPRIO, DEPARTAMENTO, EMPRESA e null', () => {
    const caller = { a: Scope.EMPRESA, b: Scope.EMPRESA, c: Scope.EMPRESA, d: Scope.EMPRESA, e: Scope.EMPRESA };
    expect(
      findUncoveredGrants(caller, [
        { permissionCode: 'a', scope: Scope.EQUIPE },
        { permissionCode: 'b', scope: Scope.PROPRIO },
        { permissionCode: 'c', scope: Scope.DEPARTAMENTO },
        { permissionCode: 'd', scope: Scope.EMPRESA },
        { permissionCode: 'e', scope: null },
      ]),
    ).toEqual([]);
  });

  it('null (sem alcance) do chamador cobre qualquer alcance', () => {
    const caller = { a: null, b: null, c: null };
    expect(
      findUncoveredGrants(caller, [
        { permissionCode: 'a', scope: Scope.EMPRESA },
        { permissionCode: 'b', scope: Scope.EQUIPE },
        { permissionCode: 'c', scope: null },
      ]),
    ).toEqual([]);
  });

  it('EQUIPE do chamador cobre só EQUIPE', () => {
    const caller = { a: Scope.EQUIPE };
    expect(findUncoveredGrants(caller, [{ permissionCode: 'a', scope: Scope.EQUIPE }])).toEqual([]);
    expect(findUncoveredGrants(caller, [{ permissionCode: 'a', scope: Scope.EMPRESA }])).toEqual(['a']);
    expect(findUncoveredGrants(caller, [{ permissionCode: 'a', scope: Scope.PROPRIO }])).toEqual(['a']);
    expect(findUncoveredGrants(caller, [{ permissionCode: 'a', scope: Scope.DEPARTAMENTO }])).toEqual(['a']);
    expect(findUncoveredGrants(caller, [{ permissionCode: 'a', scope: null }])).toEqual(['a']);
  });

  it('código que o chamador não tem nunca é coberto', () => {
    expect(findUncoveredGrants({ a: Scope.EMPRESA }, [{ permissionCode: 'b', scope: null }])).toEqual(['b']);
    expect(findUncoveredGrants({}, [{ permissionCode: 'b', scope: Scope.EQUIPE }])).toEqual(['b']);
  });

  it('devolve os códigos não cobertos na ordem dos grants do alvo, sem repetir', () => {
    expect(
      findUncoveredGrants({ b: Scope.EMPRESA }, [
        { permissionCode: 'c', scope: null },
        { permissionCode: 'b', scope: Scope.EQUIPE },
        { permissionCode: 'a', scope: Scope.EMPRESA },
        { permissionCode: 'c', scope: null },
      ]),
    ).toEqual(['c', 'a']);
  });

  it('lista vazia de grants do alvo está sempre dentro', () => {
    expect(findUncoveredGrants({}, [])).toEqual([]);
  });
});

describe('permissionLabels', () => {
  it('usa o labelPt do catálogo, separado por vírgula', () => {
    expect(permissionLabels(['usuarios.gerenciar', 'dashboard.ver'])).toBe('Gerenciar Usuários e Perfis, Ver Dashboard');
  });

  it('cai no próprio código quando não está no catálogo', () => {
    expect(permissionLabels(['inexistente.foo'])).toBe('inexistente.foo');
  });
});
