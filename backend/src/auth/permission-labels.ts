// Traduz um código de permissão do catálogo (`funcionarios.ver`, `clientes.gerenciar`, ...) pra
// área/ação em português usadas na mensagem amigável de 403 (ver Global Constraints da task de
// permissões por ação e alcance). A área nem sempre é igual ao `resource` do catálogo (ex.:
// `ponto.feriados.gerenciar` tem resource `ponto`, mas a área da mensagem é "Feriados").
export type PermissionMessageAction = 'ver' | 'alterar';

export interface PermissionLabel {
  area: string;
  action: PermissionMessageAction;
}

// Só os códigos que hoje entram no mapa rota -> permissão da spec precisam de entrada aqui — os
// nomes de área são exatamente os citados nas Global Constraints. Um código fora desta lista cai no
// fallback abaixo (capitaliza o resource do catálogo), o que nunca deveria acontecer em produção
// pra uma rota já coberta por `@RequirePermission`.
const AREA_BY_CODE: Record<string, string> = {
  'clientes.ver': 'Clientes',
  'clientes.gerenciar': 'Clientes',
  'financas.lancamentos.ver': 'Lançamentos',
  'financas.lancamentos.gerenciar': 'Lançamentos',
  'cargos.ver': 'Cargos',
  'cargos.gerenciar': 'Cargos',
  'funcionarios.ver': 'Funcionários',
  'funcionarios.gerenciar': 'Funcionários',
  'funcionarios.proprios.gerenciar': 'Funcionários',
  'advertencias.gerenciar': 'Advertências',
  'pagamentos.gerenciar': 'Pagamentos',
  'ferias.gerenciar': 'Férias e afastamentos',
  'ponto.registrar': 'Ponto',
  'ponto.administrar': 'Ponto',
  'ponto.feriados.gerenciar': 'Feriados',
  'usuarios.gerenciar': 'Usuários e perfis',
  'campos-personalizados.gerenciar': 'Campos personalizados',
};

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function getPermissionLabel(code: string): PermissionLabel {
  const area = AREA_BY_CODE[code] ?? capitalize(code.split('.')[0] ?? code);
  // A ação da mensagem só distingue "ver" (leitura) de "alterar" (qualquer escrita: gerenciar,
  // administrar, registrar, etc.) — derivada do próprio código, não do campo `action` bruto do
  // catálogo (que pra `financas.lancamentos.ver` é `lancamentos.ver`, não `ver`).
  const action: PermissionMessageAction = code.endsWith('.ver') ? 'ver' : 'alterar';
  return { area, action };
}

export function buildPermissionDeniedMessage(code: string): string {
  const { area, action } = getPermissionLabel(code);
  return `Seu perfil não permite ${action} ${area}. Fale com quem administra os acessos da empresa.`;
}
