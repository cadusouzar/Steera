import { Briefcase, Crown, Headset, Sparkles, UserRound, Wallet, type LucideIcon } from 'lucide-react';
import type { PermissionCatalogEntry } from './api';
import { clampScope, widestScope, type GrantMap, type Scope } from './profileEditorModel';

// Modelos prontos do passo 1 do editor de Perfis ("Comece por um modelo", 27/09/2026). Cada modelo
// só usa códigos do catálogo; um código que não exista no catálogo recebido é ignorado, e o escopo é
// sempre ajustado para um valor válido daquele código.

export interface ProfileTemplate {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** `'all'` = todo o catálogo, com o escopo mais amplo válido de cada código. */
  grants: { code: string; scope?: Scope }[] | 'all';
}

export const PROFILE_TEMPLATES: ProfileTemplate[] = [
  {
    key: 'funcionario',
    title: 'Funcionário comum',
    description: 'Bate o próprio ponto e vê os próprios dados.',
    icon: UserRound,
    grants: [{ code: 'dashboard.ver' }, { code: 'funcionarios.ver', scope: 'PROPRIO' }, { code: 'ponto.registrar' }],
  },
  {
    key: 'atendente',
    title: 'Atendente',
    description: 'Atende clientes: vê, cadastra e altera. Também bate ponto.',
    icon: Headset,
    grants: [
      { code: 'dashboard.ver' },
      { code: 'clientes.ver', scope: 'EMPRESA' },
      { code: 'clientes.gerenciar', scope: 'EMPRESA' },
      { code: 'ponto.registrar' },
    ],
  },
  {
    key: 'financeiro',
    title: 'Financeiro',
    description: 'Cuida dos lançamentos, dos pagamentos e vê os clientes.',
    icon: Wallet,
    grants: [
      { code: 'dashboard.ver' },
      { code: 'clientes.ver', scope: 'EMPRESA' },
      { code: 'funcionarios.ver', scope: 'EMPRESA' },
      { code: 'financas.lancamentos.ver', scope: 'EMPRESA' },
      { code: 'financas.lancamentos.gerenciar', scope: 'EMPRESA' },
      { code: 'pagamentos.gerenciar', scope: 'EMPRESA' },
      { code: 'ponto.registrar' },
    ],
  },
  {
    key: 'rh',
    title: 'Gerente de RH',
    description: 'Cuida de cargos, funcionários, férias e do ponto de todos.',
    icon: Briefcase,
    grants: [
      { code: 'dashboard.ver' },
      { code: 'cargos.ver', scope: 'EMPRESA' },
      { code: 'cargos.gerenciar', scope: 'EMPRESA' },
      { code: 'funcionarios.ver', scope: 'EMPRESA' },
      { code: 'funcionarios.gerenciar', scope: 'EMPRESA' },
      { code: 'ferias.gerenciar', scope: 'EMPRESA' },
      { code: 'advertencias.gerenciar', scope: 'EMPRESA' },
      { code: 'pagamentos.gerenciar', scope: 'EMPRESA' },
      { code: 'ponto.registrar' },
      { code: 'ponto.administrar', scope: 'EMPRESA' },
      { code: 'ponto.feriados.gerenciar' },
    ],
  },
  {
    key: 'admin',
    title: 'Administrador',
    description: 'Pode tudo, inclusive pessoas, perfis e assinatura.',
    icon: Crown,
    grants: 'all',
  },
  {
    key: 'zero',
    title: 'Começar do zero',
    description: 'Tudo desmarcado. Você escolhe cada item.',
    icon: Sparkles,
    grants: [],
  },
];

export function buildTemplateGrants(template: ProfileTemplate, catalog: PermissionCatalogEntry[]): GrantMap {
  const map: GrantMap = {};
  if (template.grants === 'all') {
    for (const entry of catalog) map[entry.code] = widestScope(entry);
    return map;
  }
  const byCode = new Map(catalog.map((e) => [e.code, e]));
  for (const item of template.grants) {
    const entry = byCode.get(item.code);
    if (!entry) continue;
    map[item.code] = entry.validScopes.length === 0 ? null : item.scope ? clampScope(item.scope, entry.validScopes) : widestScope(entry);
  }
  return map;
}
