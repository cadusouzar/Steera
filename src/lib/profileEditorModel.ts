import type { PermissionCatalogEntry, ProfileGrant } from './api';

// Modelo puro do editor de Perfis "Modelo pronto + perguntas simples" (27/09/2026, ver [[Profiles]]
// no vault). Nada aqui conversa com a API: só traduz entre o formato de `ProfileGrant[]` (que nunca
// mudou) e as perguntas em linguagem simples mostradas na tela.
//
// Garantia de ida-e-volta: o estado do editor é o próprio mapa de grants (`GrantMap`). Cada área só
// reescreve os SEUS códigos quando a pessoa mexe nela — abrir um perfil existente e salvar sem mexer
// em nada devolve exatamente o mesmo conjunto de grants (inclusive códigos fora do catálogo e
// escopos "misturados" que as perguntas simples não conseguem representar).

export type Scope = NonNullable<ProfileGrant['scope']>;

/** Código → escopo (`null` quando a permissão não tem escopo). Ausente = não concedido. */
export type GrantMap = Record<string, Scope | null>;

export type CatalogIndex = Map<string, PermissionCatalogEntry>;

export const SCOPE_ORDER: Scope[] = ['PROPRIO', 'EQUIPE', 'DEPARTAMENTO', 'EMPRESA'];

export function indexCatalog(catalog: PermissionCatalogEntry[]): CatalogIndex {
  return new Map(catalog.map((entry) => [entry.code, entry]));
}

export function grantsToMap(grants: ProfileGrant[]): GrantMap {
  const map: GrantMap = {};
  for (const g of grants) map[g.permissionCode] = g.scope ?? null;
  return map;
}

export function mapToGrants(map: GrantMap): ProfileGrant[] {
  return Object.entries(map).map(([permissionCode, scope]) => ({ permissionCode, scope }));
}

/** Escopo válido mais próximo do desejado (empate → o mais restrito, por segurança). */
export function clampScope(desired: Scope, validScopes: Scope[]): Scope | null {
  if (validScopes.length === 0) return null;
  if (validScopes.includes(desired)) return desired;
  const target = SCOPE_ORDER.indexOf(desired);
  let best = validScopes[0];
  let bestDistance = Infinity;
  for (const scope of [...validScopes].sort((a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b))) {
    const distance = Math.abs(SCOPE_ORDER.indexOf(scope) - target);
    if (distance < bestDistance) {
      best = scope;
      bestDistance = distance;
    }
  }
  return best;
}

export function widestScope(entry: PermissionCatalogEntry): Scope | null {
  return clampScope('EMPRESA', entry.validScopes);
}

function sortedScopes(scopes: Scope[]): Scope[] {
  return SCOPE_ORDER.filter((s) => scopes.includes(s));
}

// ---------------------------------------------------------------------------------------------
// Frases de escopo
// ---------------------------------------------------------------------------------------------

export const SCOPE_ANSWER_LABEL: Record<Scope, string> = {
  PROPRIO: 'Só o próprio cadastro',
  EQUIPE: 'Da equipe que ela lidera',
  DEPARTAMENTO: 'Do departamento dela',
  EMPRESA: 'De toda a empresa',
};

const SCOPE_SUMMARY: Record<Scope, string> = {
  PROPRIO: 'só o próprio cadastro',
  EQUIPE: 'da equipe que ela lidera',
  DEPARTAMENTO: 'do departamento dela',
  EMPRESA: 'de toda a empresa',
};

// ---------------------------------------------------------------------------------------------
// Operações genéricas sobre o GrantMap
// ---------------------------------------------------------------------------------------------

function setCode(map: GrantMap, catalog: CatalogIndex, code: string, desired: Scope | null): void {
  const entry = catalog.get(code);
  if (!entry) return;
  if (entry.validScopes.length === 0) {
    map[code] = null;
    return;
  }
  map[code] = desired ? clampScope(desired, entry.validScopes) : widestScope(entry);
}

export function toggleCode(map: GrantMap, catalog: CatalogIndex, code: string, on: boolean): GrantMap {
  const next = { ...map };
  if (!on) {
    delete next[code];
    return next;
  }
  if (code in next) return next;
  setCode(next, catalog, code, null);
  return next;
}

export function setCodeScope(map: GrantMap, catalog: CatalogIndex, code: string, scope: Scope | null): GrantMap {
  const next = { ...map };
  if (scope === null) {
    delete next[code];
    return next;
  }
  setCode(next, catalog, code, scope);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Áreas "Nada / Só consultar / Consultar e editar" (Clientes, Cargos, Financeiro)
// ---------------------------------------------------------------------------------------------

export type Level = 'none' | 'view' | 'full';

export interface LevelPair {
  verCode: string;
  manageCode: string;
}

export function readLevel(map: GrantMap, pair: LevelPair): Level {
  if (pair.manageCode in map) return 'full';
  if (pair.verCode in map) return 'view';
  return 'none';
}

export function writeLevel(map: GrantMap, catalog: CatalogIndex, pair: LevelPair, level: Level, preferredScope?: Scope): GrantMap {
  const next = { ...map };
  const currentScope = preferredScope ?? next[pair.manageCode] ?? next[pair.verCode] ?? 'EMPRESA';
  delete next[pair.verCode];
  delete next[pair.manageCode];
  if (level === 'none') return next;
  setCode(next, catalog, pair.verCode, currentScope);
  if (level === 'full') setCode(next, catalog, pair.manageCode, currentScope);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Funcionários (nível + "De quais funcionários?" + "Também pode:")
// ---------------------------------------------------------------------------------------------

export const FUNCIONARIOS_PAIR: LevelPair = { verCode: 'funcionarios.ver', manageCode: 'funcionarios.gerenciar' };

export const FUNCIONARIOS_EXTRAS: { code: string; label: string; summary: string }[] = [
  { code: 'ferias.gerenciar', label: 'Agendar e cancelar férias e afastamentos', summary: 'Agenda férias e afastamentos' },
  { code: 'advertencias.gerenciar', label: 'Registrar advertências', summary: 'Registra advertências' },
  { code: 'pagamentos.gerenciar', label: 'Marcar pagamentos de funcionários', summary: 'Marca pagamentos de funcionários' },
];

export interface FuncionariosView {
  level: Level;
  scope: Scope;
  extras: string[];
}

export function readFuncionarios(map: GrantMap): FuncionariosView {
  const level = readLevel(map, FUNCIONARIOS_PAIR);
  const extras = FUNCIONARIOS_EXTRAS.map((e) => e.code).filter((code) => code in map);
  const scope =
    map[FUNCIONARIOS_PAIR.manageCode] ??
    map[FUNCIONARIOS_PAIR.verCode] ??
    extras.map((code) => map[code]).find((s): s is Scope => !!s) ??
    'EMPRESA';
  return { level, scope, extras };
}

/** Escopos que a pergunta "De quais funcionários?" oferece para o nível escolhido. */
export function funcionariosScopeOptions(catalog: CatalogIndex, view: FuncionariosView): Scope[] {
  const verScopes = catalog.get(FUNCIONARIOS_PAIR.verCode)?.validScopes ?? [];
  const manageScopes = catalog.get(FUNCIONARIOS_PAIR.manageCode)?.validScopes ?? [];
  if (view.level === 'view') return sortedScopes(verScopes);
  if (view.level === 'full') return sortedScopes(manageScopes.filter((s) => verScopes.includes(s)));
  // Sem acesso ao cadastro, mas com alguma ação extra marcada: as opções vêm das ações extras.
  const extraScopes = new Set<Scope>();
  for (const code of view.extras) for (const s of catalog.get(code)?.validScopes ?? []) extraScopes.add(s);
  return sortedScopes([...extraScopes]);
}

/** Ajusta a resposta de escopo para uma opção válida (a mais próxima) depois de mudar o nível. */
export function normalizeFuncionariosView(catalog: CatalogIndex, view: FuncionariosView): FuncionariosView {
  const options = funcionariosScopeOptions(catalog, view);
  const scope = options.length > 0 ? clampScope(view.scope, options) ?? view.scope : view.scope;
  // "Só o próprio cadastro" não combina com as ações extras (nenhuma aceita PROPRIO).
  const extras = scope === 'PROPRIO' ? [] : view.extras;
  return { ...view, scope, extras };
}

export function writeFuncionarios(map: GrantMap, catalog: CatalogIndex, view: FuncionariosView): GrantMap {
  let next = writeLevel(map, catalog, FUNCIONARIOS_PAIR, view.level, view.scope);
  next = { ...next };
  for (const extra of FUNCIONARIOS_EXTRAS) {
    delete next[extra.code];
    if (view.extras.includes(extra.code)) setCode(next, catalog, extra.code, view.scope);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Áreas e resumos
// ---------------------------------------------------------------------------------------------

export type AreaKey =
  | 'inicio'
  | 'clientes'
  | 'cargos'
  | 'funcionarios'
  | 'ponto'
  | 'financeiro'
  | 'comercial'
  | 'administracao'
  | 'outras';

export interface CheckboxItem {
  code: string;
  label: string;
  hint?: string;
  summary: string;
}

export const INICIO_ITEMS: CheckboxItem[] = [
  { code: 'dashboard.ver', label: 'Ver a página inicial com os resumos', summary: 'Vê a página inicial com os resumos' },
];

export const COMERCIAL_ITEMS: CheckboxItem[] = [
  { code: 'comercial.ver', label: 'Ver a área Comercial', summary: 'Vê a área Comercial' },
  { code: 'operacoes.ver', label: 'Ver a área de Operações', summary: 'Vê a área de Operações' },
];

export const ADMINISTRACAO_ITEMS: CheckboxItem[] = [
  { code: 'usuarios.gerenciar', label: 'Criar logins e montar perfis de acesso', hint: 'Cuida de quem entra no sistema e do que cada um pode fazer.', summary: 'Cria logins e monta perfis de acesso' },
  { code: 'assinatura.gerenciar', label: 'Gerenciar a assinatura e o plano da empresa', hint: 'Pode contratar ou trocar o plano.', summary: 'Gerencia a assinatura e o plano' },
  { code: 'campos-personalizados.gerenciar', label: 'Criar campos personalizados', hint: 'Adiciona informações extras nos cadastros.', summary: 'Cria campos personalizados' },
];

export const PONTO_REGISTRAR = 'ponto.registrar';
export const PONTO_ADMINISTRAR = 'ponto.administrar';
export const PONTO_FERIADOS = 'ponto.feriados.gerenciar';

export const PONTO_ADMIN_LABEL: Record<Scope, string> = {
  PROPRIO: 'Só o próprio ponto',
  EQUIPE: 'Da equipe que ela lidera',
  DEPARTAMENTO: 'Do departamento dela',
  EMPRESA: 'De toda a empresa',
};

export interface LevelAreaConfig {
  pair: LevelPair;
  noun: string;
  viewLabel: string;
  fullLabel: string;
  viewSummary: string;
  fullSummary: string;
}

export const LEVEL_AREAS: Record<'clientes' | 'cargos' | 'financeiro', LevelAreaConfig> = {
  clientes: {
    pair: { verCode: 'clientes.ver', manageCode: 'clientes.gerenciar' },
    noun: 'clientes',
    viewLabel: 'Só consultar',
    fullLabel: 'Consultar, cadastrar e editar',
    viewSummary: 'Só consulta os clientes',
    fullSummary: 'Consulta, cadastra e edita clientes',
  },
  cargos: {
    pair: { verCode: 'cargos.ver', manageCode: 'cargos.gerenciar' },
    noun: 'cargos',
    viewLabel: 'Só consultar',
    fullLabel: 'Consultar, cadastrar e editar',
    viewSummary: 'Só consulta os cargos',
    fullSummary: 'Consulta, cadastra e edita cargos',
  },
  financeiro: {
    pair: { verCode: 'financas.lancamentos.ver', manageCode: 'financas.lancamentos.gerenciar' },
    noun: 'lançamentos',
    viewLabel: 'Só consultar lançamentos',
    fullLabel: 'Consultar e lançar',
    viewSummary: 'Só consulta os lançamentos',
    fullSummary: 'Consulta e faz lançamentos',
  },
};

export interface AreaDef {
  key: AreaKey;
  title: string;
  /** Códigos do catálogo que esta área controla (só os que existem no catálogo atual). */
  codes: string[];
}

function present(catalog: CatalogIndex, codes: string[]): string[] {
  return codes.filter((c) => catalog.has(c));
}

/** Áreas do editor, só com o que existe no catálogo; o que sobrar vai para "Outras". */
export function buildAreas(catalog: CatalogIndex): AreaDef[] {
  const areas: AreaDef[] = [];
  const pairComplete = (pair: LevelPair) => catalog.has(pair.verCode) && catalog.has(pair.manageCode);

  const inicio = present(catalog, INICIO_ITEMS.map((i) => i.code));
  if (inicio.length) areas.push({ key: 'inicio', title: 'Página inicial', codes: inicio });
  if (pairComplete(LEVEL_AREAS.clientes.pair)) areas.push({ key: 'clientes', title: 'Clientes', codes: [LEVEL_AREAS.clientes.pair.verCode, LEVEL_AREAS.clientes.pair.manageCode] });
  if (pairComplete(LEVEL_AREAS.cargos.pair)) areas.push({ key: 'cargos', title: 'Cargos', codes: [LEVEL_AREAS.cargos.pair.verCode, LEVEL_AREAS.cargos.pair.manageCode] });
  if (pairComplete(FUNCIONARIOS_PAIR)) {
    areas.push({
      key: 'funcionarios',
      title: 'Funcionários',
      codes: [FUNCIONARIOS_PAIR.verCode, FUNCIONARIOS_PAIR.manageCode, ...present(catalog, FUNCIONARIOS_EXTRAS.map((e) => e.code))],
    });
  }
  const ponto = present(catalog, [PONTO_REGISTRAR, PONTO_ADMINISTRAR, PONTO_FERIADOS]);
  if (ponto.length) areas.push({ key: 'ponto', title: 'Controle de Ponto', codes: ponto });
  if (pairComplete(LEVEL_AREAS.financeiro.pair)) areas.push({ key: 'financeiro', title: 'Financeiro', codes: [LEVEL_AREAS.financeiro.pair.verCode, LEVEL_AREAS.financeiro.pair.manageCode] });
  const comercial = present(catalog, COMERCIAL_ITEMS.map((i) => i.code));
  if (comercial.length) areas.push({ key: 'comercial', title: 'Comercial e Operações', codes: comercial });
  const administracao = present(catalog, ADMINISTRACAO_ITEMS.map((i) => i.code));
  if (administracao.length) areas.push({ key: 'administracao', title: 'Administração', codes: administracao });

  const used = new Set(areas.flatMap((a) => a.codes));
  const outras = [...catalog.keys()].filter((code) => !used.has(code));
  if (outras.length) areas.push({ key: 'outras', title: 'Outras', codes: outras });
  return areas;
}

export function outrasItems(catalog: CatalogIndex, area: AreaDef): CheckboxItem[] {
  return area.codes.map((code) => {
    const label = catalog.get(code)?.labelPt ?? code;
    return { code, label, summary: label };
  });
}

export interface SummaryLine {
  ok: boolean;
  text: string;
}

const NO_ACCESS: SummaryLine = { ok: false, text: 'Não tem acesso' };

function checkboxSummary(map: GrantMap, items: CheckboxItem[]): SummaryLine[] {
  const lines = items.filter((i) => i.code in map).map((i) => ({ ok: true, text: i.summary }));
  return lines.length ? lines : [NO_ACCESS];
}

export function summarizeArea(map: GrantMap, catalog: CatalogIndex, area: AreaDef): SummaryLine[] {
  switch (area.key) {
    case 'inicio':
      return INICIO_ITEMS[0].code in map
        ? [{ ok: true, text: INICIO_ITEMS[0].summary }]
        : [{ ok: false, text: 'Não vê a página inicial' }];
    case 'clientes':
    case 'cargos':
    case 'financeiro': {
      const cfg = LEVEL_AREAS[area.key];
      const level = readLevel(map, cfg.pair);
      if (level === 'full') return [{ ok: true, text: cfg.fullSummary }];
      if (level === 'view') return [{ ok: true, text: cfg.viewSummary }];
      return [NO_ACCESS];
    }
    case 'funcionarios': {
      const lines: SummaryLine[] = [];
      const ver = map[FUNCIONARIOS_PAIR.verCode];
      const manage = map[FUNCIONARIOS_PAIR.manageCode];
      const hasVer = FUNCIONARIOS_PAIR.verCode in map;
      const hasManage = FUNCIONARIOS_PAIR.manageCode in map;
      let mainScope: Scope | null = null;
      if (hasManage && (!hasVer || ver === manage)) {
        mainScope = manage ?? null;
        lines.push({ ok: true, text: `Consulta, cadastra e edita${manage ? ` — ${SCOPE_SUMMARY[manage]}` : ''}` });
      } else {
        if (hasVer) {
          mainScope = ver ?? null;
          lines.push({ ok: true, text: `Consulta${ver ? ` — ${SCOPE_SUMMARY[ver]}` : ''}` });
        }
        if (hasManage) lines.push({ ok: true, text: `Cadastra e edita${manage ? ` — ${SCOPE_SUMMARY[manage]}` : ''}` });
      }
      for (const extra of FUNCIONARIOS_EXTRAS) {
        if (!(extra.code in map)) continue;
        const s = map[extra.code];
        const suffix = s && s !== mainScope ? ` — ${SCOPE_SUMMARY[s]}` : '';
        lines.push({ ok: true, text: `${extra.summary}${suffix}` });
      }
      return lines.length ? lines : [NO_ACCESS];
    }
    case 'ponto': {
      const lines: SummaryLine[] = [];
      if (catalog.has(PONTO_REGISTRAR)) {
        lines.push(PONTO_REGISTRAR in map ? { ok: true, text: 'Bate o próprio ponto' } : { ok: false, text: 'Não bate ponto' });
      }
      if (catalog.has(PONTO_ADMINISTRAR)) {
        const s = map[PONTO_ADMINISTRAR];
        lines.push(
          PONTO_ADMINISTRAR in map
            ? { ok: true, text: `Administra o ponto${s ? ` — ${SCOPE_SUMMARY[s]}` : ''}` }
            : { ok: false, text: 'Não administra o ponto' },
        );
      }
      if (PONTO_FERIADOS in map) lines.push({ ok: true, text: 'Cadastra feriados da empresa' });
      return lines.length ? lines : [NO_ACCESS];
    }
    case 'comercial':
      return checkboxSummary(map, COMERCIAL_ITEMS);
    case 'administracao':
      return checkboxSummary(map, ADMINISTRACAO_ITEMS);
    case 'outras':
      return checkboxSummary(map, outrasItems(catalog, area));
  }
}
