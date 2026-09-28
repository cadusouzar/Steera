import type { CurrentUser } from './auth';
import type { ProfileGrant } from './api';

// Espelho da regra de "concessão limitada" do backend (backend/src/permissions/grant-coverage.util.ts):
// quem gerencia acessos só concede o que o próprio perfil também tem. Aqui só serve pra esconder ou
// desabilitar o que o backend recusaria (403 PERMISSION_REQUIRED); a regra de verdade continua lá.
//
// Cobertura de um grant (código + alcance) pelo chamador:
// - o chamador precisa ter o mesmo código;
// - alcance do chamador EMPRESA ou null (sem alcance) cobre qualquer alcance, inclusive null;
// - qualquer outro alcance do chamador só cobre exatamente o mesmo alcance;
// - um grant sem alcance (null) no alvo só é coberto por EMPRESA/null.

type GrantScope = ProfileGrant['scope'];

/** Permissões do chamador (código → alcance), no mesmo formato de `CurrentUser.permissions`. */
export type CallerGrants = Record<string, GrantScope | undefined>;

/** Alvo: lista de grants (formato da API) ou mapa código → alcance (formato do editor de Perfis). */
export type TargetGrants = ProfileGrant[] | Record<string, GrantScope>;

function toEntries(target: TargetGrants): [string, GrantScope][] {
  if (Array.isArray(target)) return target.map((g) => [g.permissionCode, g.scope ?? null]);
  return Object.entries(target).map(([code, scope]) => [code, scope ?? null]);
}

export function isGrantCovered(caller: CallerGrants, code: string, scope: GrantScope): boolean {
  if (!(code in caller)) return false;
  const callerScope = caller[code] ?? null;
  if (callerScope === null || callerScope === 'EMPRESA') return true;
  return scope !== null && callerScope === scope;
}

/** Códigos do alvo que o chamador NÃO cobre, na ordem do alvo, sem repetir. */
export function findUncoveredGrants(caller: CallerGrants, target: TargetGrants): string[] {
  const uncovered: string[] = [];
  for (const [code, scope] of toEntries(target)) {
    if (!isGrantCovered(caller, code, scope) && !uncovered.includes(code)) uncovered.push(code);
  }
  return uncovered;
}

export function isWithinCaller(caller: CallerGrants, target: TargetGrants): boolean {
  return findUncoveredGrants(caller, target).length === 0;
}

export function callerGrantsOf(user: CurrentUser | null): CallerGrants {
  return user?.permissions ?? {};
}

// ---------------------------------------------------------------------------------------------
// "Pode alterar os próprios dados?" (funcionarios.proprios.gerenciar)
// ---------------------------------------------------------------------------------------------

export const OWN_DATA_PERMISSION = 'funcionarios.proprios.gerenciar';

export const OWN_DATA_LOCKED_MESSAGE = 'Seu perfil não permite alterar os próprios dados.';

/**
 * Verdadeiro quando a ficha é a do próprio login e o perfil não concede alterar os próprios dados:
 * o backend recusaria qualquer escrita nela (salário, pagamentos, férias, afastamentos, advertências).
 */
export function isOwnDataLocked(user: CurrentUser | null, employeeId: string | null | undefined): boolean {
  if (!user || !employeeId || !user.employeeId) return false;
  return employeeId === user.employeeId && !(OWN_DATA_PERMISSION in (user.permissions ?? {}));
}

/** Texto do aviso ao lado das opções que o perfil de quem está editando não tem. */
export const NOT_IN_YOUR_PROFILE_HINT = 'Seu perfil não tem essa permissão';

export const PROFILE_ABOVE_CALLER_MESSAGE =
  'Este perfil tem permissões que o seu perfil não tem. Só quem tem todas elas pode alterá-lo.';

export const LOGIN_ABOVE_CALLER_MESSAGE =
  'Este login tem permissões que o seu perfil não tem. Só quem tem todas elas pode alterá-lo.';

export const LINK_REQUIRES_FULL_SCOPE_HINT =
  'Para criar logins de funcionários ou vincular fichas, é preciso ter acesso a todos os funcionários da empresa.';
