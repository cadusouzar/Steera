// Permissões que a empresa nunca pode perder por completo — a trava de último detentor
// (`backend/src/users/last-permission-holder.util.ts`) roda para cada uma delas em todo caminho
// capaz de remover um detentor: editar as permissões de um perfil, reatribuir-e-excluir um perfil,
// trocar o perfil de um login, bloquear ou excluir um login.
//
// Vive num arquivo próprio (não dentro de last-permission-holder.util.ts) de propósito:
// profiles.service.spec.ts faz `jest.mock('../users/last-permission-holder.util')`, e o automock
// do Jest troca todo array exportado por um array VAZIO — a lista sumiria silenciosamente nos
// testes, e nenhuma trava rodaria.
//
// - `usuarios.gerenciar`: sem ninguém, a empresa não consegue mais administrar acesso.
// - `assinatura.gerenciar` (27/09/2026): sem ninguém, a empresa não consegue mais mudar o plano.
//
// A ordem importa só pra mensagem: quando as duas travas disparam, a de usuários aparece primeiro.
export const SUBSCRIPTION_MANAGE_PERMISSION = 'assinatura.gerenciar';

export const LAST_HOLDER_PROTECTED_PERMISSION_CODES: readonly string[] = [
  'usuarios.gerenciar',
  SUBSCRIPTION_MANAGE_PERMISSION,
];

const LAST_HOLDER_MESSAGES: Record<string, string> = {
  'usuarios.gerenciar': 'A empresa precisa ter pelo menos um login ativo com permissão para gerenciar usuários',
  [SUBSCRIPTION_MANAGE_PERMISSION]:
    'A empresa precisa ter pelo menos um login ativo com permissão para gerenciar a assinatura',
};

export function lastHolderErrorMessage(permissionCode: string): string {
  return (
    LAST_HOLDER_MESSAGES[permissionCode] ??
    `A empresa precisa ter pelo menos um login ativo com a permissão ${permissionCode}`
  );
}
