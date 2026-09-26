import { AppModule, CompanyPlanTier } from '@prisma/client';

// Catálogo de planos — FONTE ÚNICA de módulos, recursos e limites por plano (26/09/2026). O plano de
// uma empresa é só `Company.planTier`; mudar esse valor no banco (hoje manual; no futuro, o
// checkout) muda tudo na próxima requisição (PlanGuard lê sem cache). Nenhuma rota HTTP muda o plano.
export type PlanFeature = 'ANALYTICS';
export type PlanLimitKind = 'roles' | 'employees' | 'employeeLogins';

export interface PlanLimits {
  maxRoles: number | null; // null = sem limite
  maxEmployees: number | null;
  maxEmployeeLogins: number | null;
}

export interface PlanDefinition {
  tier: CompanyPlanTier;
  label: string;
  priceLabel: string;
  modules: AppModule[];
  features: PlanFeature[];
  limits: PlanLimits;
}

const FREE_MODULES: AppModule[] = ['DASHBOARD', 'CLIENTES', 'RH_CARGOS', 'RH_FUNCIONARIOS'];
const BASIC_MODULES: AppModule[] = [...FREE_MODULES, 'PONTO_REGISTRO', 'PONTO_ADMINISTRACAO'];
const ALL_MODULES: AppModule[] = [...BASIC_MODULES, 'COMERCIAL', 'OPERACOES', 'FINANCAS'];

// Ordem crescente (do mais barato ao mais caro) — minimumPlanFor depende disso.
export const PLAN_CATALOG: readonly PlanDefinition[] = [
  { tier: 'GRATIS', label: 'Grátis', priceLabel: 'R$ 0', modules: FREE_MODULES, features: [], limits: { maxRoles: 5, maxEmployees: 10, maxEmployeeLogins: 2 } },
  { tier: 'BASICO', label: 'Básico', priceLabel: 'R$ 99/mês', modules: BASIC_MODULES, features: [], limits: { maxRoles: null, maxEmployees: null, maxEmployeeLogins: 10 } },
  { tier: 'PRO', label: 'Pro', priceLabel: 'R$ 299/mês', modules: ALL_MODULES, features: ['ANALYTICS'], limits: { maxRoles: null, maxEmployees: null, maxEmployeeLogins: 50 } },
  { tier: 'EMPRESARIAL', label: 'Empresarial', priceLabel: 'Sob consulta', modules: ALL_MODULES, features: ['ANALYTICS'], limits: { maxRoles: null, maxEmployees: null, maxEmployeeLogins: null } },
];

export const FEATURE_LABELS: Record<string, string> = {
  DASHBOARD: 'Visão Geral',
  CLIENTES: 'Clientes',
  RH_CARGOS: 'Cargos',
  RH_FUNCIONARIOS: 'Funcionários',
  PONTO_REGISTRO: 'Ponto',
  PONTO_ADMINISTRACAO: 'Administração do Ponto',
  COMERCIAL: 'Comercial',
  OPERACOES: 'Operações',
  FINANCAS: 'Finanças',
  ANALYTICS: 'Analytics e Dashboards',
};

const LIMIT_NOUNS: Record<PlanLimitKind, string> = {
  roles: 'cargos ativos',
  employees: 'funcionários ativos',
  employeeLogins: 'logins de funcionário ativos',
};

const LIMIT_KEYS: Record<PlanLimitKind, keyof PlanLimits> = {
  roles: 'maxRoles',
  employees: 'maxEmployees',
  employeeLogins: 'maxEmployeeLogins',
};

export function getPlan(tier: CompanyPlanTier): PlanDefinition {
  const plan = PLAN_CATALOG.find((p) => p.tier === tier);
  if (!plan) throw new Error(`Plano desconhecido: ${tier}`);
  return plan;
}

export function planAllowsModule(tier: CompanyPlanTier, module: AppModule): boolean {
  return getPlan(tier).modules.includes(module);
}

export function planAllowsFeature(tier: CompanyPlanTier, feature: PlanFeature): boolean {
  return getPlan(tier).features.includes(feature);
}

export function minimumPlanFor(item: AppModule | PlanFeature): PlanDefinition {
  const plan = PLAN_CATALOG.find((p) => (p.modules as string[]).includes(item) || (p.features as string[]).includes(item));
  if (!plan) throw new Error(`Nenhum plano inclui ${item}`);
  return plan;
}

// Tudo o que o plano NÃO inclui (módulos + recursos), com o plano mínimo que libera — o frontend usa
// pra desenhar cadeados e a tela de upgrade.
export function lockedItemsFor(tier: CompanyPlanTier): Record<string, { tier: CompanyPlanTier; label: string }> {
  const locked: Record<string, { tier: CompanyPlanTier; label: string }> = {};
  for (const item of [...ALL_MODULES, 'ANALYTICS' as const]) {
    const allowed = item === 'ANALYTICS' ? planAllowsFeature(tier, item) : planAllowsModule(tier, item);
    if (!allowed) {
      const min = minimumPlanFor(item);
      locked[item] = { tier: min.tier, label: min.label };
    }
  }
  return locked;
}

export function planLimitMessage(tier: CompanyPlanTier, kind: PlanLimitKind): string {
  const plan = getPlan(tier);
  const max = plan.limits[LIMIT_KEYS[kind]];
  return `Limite do plano ${plan.label}: até ${max} ${LIMIT_NOUNS[kind]}. Faça upgrade para cadastrar mais.`;
}

export function planLimit(tier: CompanyPlanTier, kind: PlanLimitKind): number | null {
  return getPlan(tier).limits[LIMIT_KEYS[kind]];
}
