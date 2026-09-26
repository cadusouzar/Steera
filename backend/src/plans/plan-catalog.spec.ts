import {
  getPlan, lockedItemsFor, minimumPlanFor, planAllowsFeature, planAllowsModule, planLimitMessage, PLAN_CATALOG,
} from './plan-catalog';

describe('plan-catalog', () => {
  it('tem os 4 planos na ordem crescente', () => {
    expect(PLAN_CATALOG.map((p) => p.tier)).toEqual(['GRATIS', 'BASICO', 'PRO', 'EMPRESARIAL']);
  });

  it('Grátis: Visão Geral, Clientes e RH, sem Ponto; limites 5/10/2', () => {
    expect(planAllowsModule('GRATIS', 'CLIENTES')).toBe(true);
    expect(planAllowsModule('GRATIS', 'RH_FUNCIONARIOS')).toBe(true);
    expect(planAllowsModule('GRATIS', 'PONTO_REGISTRO')).toBe(false);
    expect(planAllowsModule('GRATIS', 'FINANCAS')).toBe(false);
    expect(getPlan('GRATIS').limits).toEqual({ maxRoles: 5, maxEmployees: 10, maxEmployeeLogins: 2 });
  });

  it('Básico libera Ponto e tira limites de cargos/funcionários; logins 10', () => {
    expect(planAllowsModule('BASICO', 'PONTO_ADMINISTRACAO')).toBe(true);
    expect(planAllowsModule('BASICO', 'COMERCIAL')).toBe(false);
    expect(planAllowsFeature('BASICO', 'ANALYTICS')).toBe(false);
    expect(getPlan('BASICO').limits).toEqual({ maxRoles: null, maxEmployees: null, maxEmployeeLogins: 10 });
  });

  it('Pro libera tudo (inclusive Analytics); Empresarial igual com logins ilimitados', () => {
    for (const m of ['COMERCIAL', 'OPERACOES', 'FINANCAS', 'PONTO_REGISTRO'] as const) {
      expect(planAllowsModule('PRO', m)).toBe(true);
      expect(planAllowsModule('EMPRESARIAL', m)).toBe(true);
    }
    expect(planAllowsFeature('PRO', 'ANALYTICS')).toBe(true);
    expect(getPlan('PRO').limits.maxEmployeeLogins).toBe(50);
    expect(getPlan('EMPRESARIAL').limits.maxEmployeeLogins).toBeNull();
  });

  it('minimumPlanFor devolve o plano mais barato que inclui o item', () => {
    expect(minimumPlanFor('PONTO_REGISTRO').tier).toBe('BASICO');
    expect(minimumPlanFor('FINANCAS').tier).toBe('PRO');
    expect(minimumPlanFor('ANALYTICS').tier).toBe('PRO');
    expect(minimumPlanFor('CLIENTES').tier).toBe('GRATIS');
  });

  it('lockedItemsFor lista o que falta, com o plano mínimo', () => {
    expect(lockedItemsFor('GRATIS')).toMatchObject({
      PONTO_REGISTRO: { tier: 'BASICO', label: 'Básico' },
      FINANCAS: { tier: 'PRO', label: 'Pro' },
      ANALYTICS: { tier: 'PRO', label: 'Pro' },
    });
    expect(lockedItemsFor('GRATIS')).not.toHaveProperty('CLIENTES');
    expect(lockedItemsFor('PRO')).toEqual({});
  });

  it('mensagem de limite', () => {
    expect(planLimitMessage('GRATIS', 'roles')).toBe(
      'Limite do plano Grátis: até 5 cargos ativos. Faça upgrade para cadastrar mais.',
    );
    expect(planLimitMessage('BASICO', 'employeeLogins')).toBe(
      'Limite do plano Básico: até 10 logins de funcionário ativos. Faça upgrade para cadastrar mais.',
    );
  });
});
