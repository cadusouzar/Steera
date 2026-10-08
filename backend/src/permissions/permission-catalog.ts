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
  // "Pode alterar os próprios dados?" (28/09/2026): exigida ALÉM da permissão e do alcance normais em
  // toda escrita cuja ficha-alvo é a do próprio login (salário, pagamentos, férias/afastamentos,
  // advertências, desativar/reativar) — ver EmployeeScopeService.assertCanWriteOwn. Sem escopo: só
  // existe uma "própria ficha". Nenhum módulo legado a concede, então perfis derivados de ADMIN a
  // recebem (getRoleOnlyGatedPermissionCodes) e os de EMPLOYEE não.
  // Estoque v1 (08/10/2026): todas concedidas pelo módulo OPERACOES (profile-signature.util.ts).
  // `estoque.custos.ver` decide se custo médio, custo unitário e valor do estoque saem da API.
  { code: 'estoque.ver', resource: 'estoque', action: 'ver', labelPt: 'Ver Estoque', validScopes: [Scope.EMPRESA] },
  { code: 'estoque.produtos.gerenciar', resource: 'estoque', action: 'produtos.gerenciar', labelPt: 'Cadastrar/editar Produtos', validScopes: [Scope.EMPRESA] },
  { code: 'estoque.movimentar', resource: 'estoque', action: 'movimentar', labelPt: 'Registrar entradas e saídas de estoque', validScopes: [Scope.EMPRESA] },
  { code: 'estoque.ajustar', resource: 'estoque', action: 'ajustar', labelPt: 'Ajustar estoque por contagem', validScopes: [Scope.EMPRESA] },
  { code: 'estoque.estornar', resource: 'estoque', action: 'estornar', labelPt: 'Estornar movimentações de estoque', validScopes: [Scope.EMPRESA] },
  { code: 'estoque.custos.ver', resource: 'estoque', action: 'custos.ver', labelPt: 'Ver custos e valor do estoque', validScopes: [Scope.EMPRESA] },
  { code: 'estoque.exportar', resource: 'estoque', action: 'exportar', labelPt: 'Exportar relatórios de estoque', validScopes: [Scope.EMPRESA] },
  { code: 'estoque.lixeira.gerenciar', resource: 'estoque', action: 'lixeira.gerenciar', labelPt: 'Excluir e restaurar Produtos', validScopes: [Scope.EMPRESA] },
  { code: 'funcionarios.proprios.gerenciar', resource: 'funcionarios', action: 'proprios.gerenciar', labelPt: 'Alterar os próprios dados', validScopes: [] },
];

export type PermissionCode = (typeof PERMISSION_CATALOG)[number]['code'];

export function getPermissionDefinition(code: string): PermissionDefinition {
  const found = PERMISSION_CATALOG.find((p) => p.code === code);
  if (!found) throw new Error(`Permissão desconhecida no catálogo: ${code}`);
  return found;
}
