import { Scope } from '@prisma/client';

export interface PermissionDefinition {
  code: string;
  resource: string;
  action: string;
  labelPt: string;
  validScopes: Scope[];
}

// Granularidade = rota que já existe separada hoje no código (nunca módulo inteiro, nunca uma
// distinção nova sem rota própria por trás — ver spec, seção "Fora do escopo"). `usuarios.gerenciar`
// cobre tudo que hoje é `@Roles('ADMIN')` em UsersController (criar/editar/bloquear/excluir/reset
// de senha/atribuir perfil) — são todas ações sobre OUTROS logins, sempre a mesma trava de
// privilégio, nunca fazia sentido separar historicamente.
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  { code: 'dashboard.ver', resource: 'dashboard', action: 'ver', labelPt: 'Ver Dashboard', validScopes: [] },
  { code: 'clientes.ver', resource: 'clientes', action: 'ver', labelPt: 'Ver Clientes', validScopes: [Scope.EMPRESA] },
  { code: 'clientes.gerenciar', resource: 'clientes', action: 'gerenciar', labelPt: 'Criar/editar Clientes', validScopes: [Scope.EMPRESA] },
  { code: 'cargos.ver', resource: 'cargos', action: 'ver', labelPt: 'Ver Cargos', validScopes: [Scope.EMPRESA] },
  { code: 'cargos.gerenciar', resource: 'cargos', action: 'gerenciar', labelPt: 'Criar/editar/desativar Cargos', validScopes: [Scope.EMPRESA] },
  { code: 'funcionarios.ver', resource: 'funcionarios', action: 'ver', labelPt: 'Ver Funcionários', validScopes: [Scope.PROPRIO, Scope.EQUIPE, Scope.DEPARTAMENTO, Scope.EMPRESA] },
  { code: 'funcionarios.gerenciar', resource: 'funcionarios', action: 'gerenciar', labelPt: 'Criar/editar/desativar Funcionários', validScopes: [Scope.EQUIPE, Scope.DEPARTAMENTO, Scope.EMPRESA] },
  { code: 'ferias.gerenciar', resource: 'ferias', action: 'gerenciar', labelPt: 'Agendar/cancelar Férias e Afastamentos', validScopes: [Scope.EQUIPE, Scope.DEPARTAMENTO, Scope.EMPRESA] },
  { code: 'advertencias.gerenciar', resource: 'advertencias', action: 'gerenciar', labelPt: 'Registrar Advertências', validScopes: [Scope.EQUIPE, Scope.DEPARTAMENTO, Scope.EMPRESA] },
  { code: 'pagamentos.gerenciar', resource: 'pagamentos', action: 'gerenciar', labelPt: 'Gerenciar pagamentos de Funcionários', validScopes: [Scope.EQUIPE, Scope.DEPARTAMENTO, Scope.EMPRESA] },
  { code: 'financas.lancamentos.ver', resource: 'financas', action: 'lancamentos.ver', labelPt: 'Ver Lançamentos', validScopes: [Scope.EMPRESA] },
  { code: 'financas.lancamentos.gerenciar', resource: 'financas', action: 'lancamentos.gerenciar', labelPt: 'Criar/editar Lançamentos e Assinaturas', validScopes: [Scope.EMPRESA] },
  { code: 'ponto.registrar', resource: 'ponto', action: 'registrar', labelPt: 'Bater o próprio ponto', validScopes: [] },
  { code: 'ponto.administrar', resource: 'ponto', action: 'administrar', labelPt: 'Administrar Controle de Ponto', validScopes: [Scope.EQUIPE, Scope.EMPRESA] },
  { code: 'ponto.feriados.gerenciar', resource: 'ponto', action: 'feriados.gerenciar', labelPt: 'Gerenciar feriados customizados', validScopes: [Scope.EMPRESA] },
  { code: 'comercial.ver', resource: 'comercial', action: 'ver', labelPt: 'Ver Comercial', validScopes: [Scope.EMPRESA] },
  { code: 'operacoes.ver', resource: 'operacoes', action: 'ver', labelPt: 'Ver Operações', validScopes: [Scope.EMPRESA] },
  { code: 'campos-personalizados.gerenciar', resource: 'campos-personalizados', action: 'gerenciar', labelPt: 'Gerenciar Campos Personalizados', validScopes: [Scope.EMPRESA] },
  { code: 'usuarios.gerenciar', resource: 'usuarios', action: 'gerenciar', labelPt: 'Gerenciar Usuários e Perfis', validScopes: [Scope.EMPRESA] },
  // Quem gerencia a assinatura (27/09/2026): comprar/trocar o plano da empresa. Sem escopo — é uma
  // ação sobre a empresa inteira, não sobre funcionário/time. Protegida pela trava de último
  // detentor (ver protected-permissions.ts). Hoje ainda não existe rota que mude o plano: a
  // permissão já decide quem VÊ as ações de compra no frontend e quem aparece como contato
  // (`GET /plans/me`); a futura rota de checkout precisa exigi-la (ver plans.controller.ts).
  { code: 'assinatura.gerenciar', resource: 'assinatura', action: 'gerenciar', labelPt: 'Gerenciar assinatura e plano', validScopes: [] },
];

export type PermissionCode = (typeof PERMISSION_CATALOG)[number]['code'];

export function getPermissionDefinition(code: string): PermissionDefinition {
  const found = PERMISSION_CATALOG.find((p) => p.code === code);
  if (!found) throw new Error(`Permissão desconhecida no catálogo: ${code}`);
  return found;
}
