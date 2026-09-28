import { Scope } from '@prisma/client';
import { PERMISSION_CATALOG } from './permission-catalog';

export interface GrantLike {
  permissionCode: string;
  scope: Scope | string | null;
}

// Concessão limitada (28/09/2026): quem gerencia acessos só concede o que também tem. Um grant do
// alvo está "dentro" do chamador quando o chamador tem o MESMO código com um alcance que o cobre:
// alcance EMPRESA ou sem alcance (null) cobre qualquer alcance (inclusive null); qualquer outro
// alcance só cobre exatamente o mesmo alcance. Devolve os códigos NÃO cobertos, na ordem em que
// aparecem nos grants do alvo, sem repetir — lista vazia = o alvo está inteiro dentro do chamador.
export function findUncoveredGrants(
  callerGrants: Record<string, Scope | string | null>,
  targetGrants: GrantLike[],
): string[] {
  const uncovered: string[] = [];
  for (const grant of targetGrants) {
    if (uncovered.includes(grant.permissionCode)) continue;
    if (!isCovered(callerGrants, grant)) uncovered.push(grant.permissionCode);
  }
  return uncovered;
}

function isCovered(callerGrants: Record<string, Scope | string | null>, grant: GrantLike): boolean {
  if (!Object.prototype.hasOwnProperty.call(callerGrants, grant.permissionCode)) return false;
  const callerScope = callerGrants[grant.permissionCode];
  if (callerScope === null || callerScope === Scope.EMPRESA) return true;
  return grant.scope !== null && grant.scope === callerScope;
}

// Rótulos pt-BR (labelPt do catálogo) separados por vírgula, pra mensagem de recusa.
export function permissionLabels(codes: string[]): string {
  return codes.map((code) => PERMISSION_CATALOG.find((p) => p.code === code)?.labelPt ?? code).join(', ');
}
