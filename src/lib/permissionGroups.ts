import type { PermissionCatalogEntry } from './api';

// Agrupamento por área pra tela de Perfis (redesenho de 27/09/2026, ver [[Profiles]] no vault).
// Puramente de apresentação — nunca muda o formato de `ProfileGrant` enviado ao backend, só como o
// catálogo (`GET /profiles/catalog`) é organizado/rotulado na tela.

export type PermissionRow =
  | { kind: 'toggle'; key: string; label: string; code: string }
  | { kind: 'level'; key: string; label: string; verCode: string; manageCode: string };

export interface PermissionGroup {
  key: string;
  label: string;
  rows: PermissionRow[];
}

interface RowSpec {
  label: string;
  code?: string;
  verCode?: string;
  manageCode?: string;
}

interface GroupSpec {
  key: string;
  label: string;
  rows: RowSpec[];
}

// Mapa estático conhecido das permissões de hoje. Qualquer código do catálogo que não apareça aqui
// cai no grupo "Outras" (ver `buildPermissionGroups`), pra a tela nunca esconder uma permissão nova
// só porque este mapa ainda não foi atualizado.
const GROUP_SPECS: GroupSpec[] = [
  {
    key: 'geral',
    label: 'Geral',
    rows: [{ label: 'Dashboard', code: 'dashboard.ver' }],
  },
  {
    key: 'clientes',
    label: 'Clientes',
    rows: [{ label: 'Clientes', verCode: 'clientes.ver', manageCode: 'clientes.gerenciar' }],
  },
  {
    key: 'rh',
    label: 'Recursos Humanos',
    rows: [
      { label: 'Cargos', verCode: 'cargos.ver', manageCode: 'cargos.gerenciar' },
      { label: 'Funcionários', verCode: 'funcionarios.ver', manageCode: 'funcionarios.gerenciar' },
      { label: 'Férias e afastamentos', code: 'ferias.gerenciar' },
      { label: 'Advertências', code: 'advertencias.gerenciar' },
      { label: 'Pagamentos de funcionários', code: 'pagamentos.gerenciar' },
    ],
  },
  {
    key: 'ponto',
    label: 'Controle de Ponto',
    rows: [
      { label: 'Bater o próprio ponto', code: 'ponto.registrar' },
      { label: 'Administrar o ponto', code: 'ponto.administrar' },
      { label: 'Feriados da empresa', code: 'ponto.feriados.gerenciar' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    rows: [
      {
        label: 'Lançamentos e assinaturas de clientes',
        verCode: 'financas.lancamentos.ver',
        manageCode: 'financas.lancamentos.gerenciar',
      },
    ],
  },
  {
    key: 'comercial-operacoes',
    label: 'Comercial e Operações',
    rows: [
      { label: 'Comercial', code: 'comercial.ver' },
      { label: 'Operações', code: 'operacoes.ver' },
    ],
  },
  {
    key: 'administracao',
    label: 'Administração',
    rows: [
      { label: 'Campos personalizados', code: 'campos-personalizados.gerenciar' },
      { label: 'Usuários e perfis', code: 'usuarios.gerenciar' },
      { label: 'Assinatura e plano', code: 'assinatura.gerenciar' },
    ],
  },
];

export function buildPermissionGroups(catalog: PermissionCatalogEntry[]): PermissionGroup[] {
  const byCode = new Map(catalog.map((entry) => [entry.code, entry]));
  const usedCodes = new Set<string>();
  const groups: PermissionGroup[] = [];

  for (const spec of GROUP_SPECS) {
    const rows: PermissionRow[] = [];
    for (const rowSpec of spec.rows) {
      const hasVer = !!rowSpec.verCode && byCode.has(rowSpec.verCode);
      const hasManage = !!rowSpec.manageCode && byCode.has(rowSpec.manageCode);
      if (rowSpec.verCode && rowSpec.manageCode && hasVer && hasManage) {
        rows.push({ kind: 'level', key: rowSpec.manageCode, label: rowSpec.label, verCode: rowSpec.verCode, manageCode: rowSpec.manageCode });
        usedCodes.add(rowSpec.verCode);
        usedCodes.add(rowSpec.manageCode);
      } else if (rowSpec.code && byCode.has(rowSpec.code)) {
        rows.push({ kind: 'toggle', key: rowSpec.code, label: rowSpec.label, code: rowSpec.code });
        usedCodes.add(rowSpec.code);
      } else if (hasVer) {
        // Par ver/gerenciar incompleto no catálogo (não deveria acontecer hoje) — mostra só o que existe.
        rows.push({ kind: 'toggle', key: rowSpec.verCode as string, label: rowSpec.label, code: rowSpec.verCode as string });
        usedCodes.add(rowSpec.verCode as string);
      } else if (hasManage) {
        rows.push({ kind: 'toggle', key: rowSpec.manageCode as string, label: rowSpec.label, code: rowSpec.manageCode as string });
        usedCodes.add(rowSpec.manageCode as string);
      }
    }
    if (rows.length > 0) groups.push({ key: spec.key, label: spec.label, rows });
  }

  const leftover = catalog.filter((entry) => !usedCodes.has(entry.code));
  if (leftover.length > 0) {
    groups.push({
      key: 'outras',
      label: 'Outras',
      rows: leftover.map((entry) => ({ kind: 'toggle', key: entry.code, label: entry.labelPt, code: entry.code })),
    });
  }

  return groups;
}
