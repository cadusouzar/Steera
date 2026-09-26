import type { PlanCatalogItem } from './api';

// Rótulos de módulos/recursos do catálogo de planos — cópia de frontend de
// backend/src/plans/plan-catalog.ts (FEATURE_LABELS), mesmo padrão de duplicação intencional já
// usado em src/lib/validation.ts (frontend nunca importa código do backend). Fonte única no
// frontend: AppLayout, AccountSubscriptionDetails e PlanUpgradeModal importam daqui.
export const PLAN_ITEM_LABELS: Record<string, string> = {
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

// Ordem crescente do catálogo (do mais barato ao mais caro) — usada pra saber quais planos ficam
// "acima" do atual (candidatos a upgrade).
export const PLAN_ORDER: PlanCatalogItem['tier'][] = ['GRATIS', 'BASICO', 'PRO', 'EMPRESARIAL'];

export function formatLimit(value: number | null): string {
  return value === null ? 'Ilimitado' : String(value);
}
