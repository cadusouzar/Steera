import { Scope } from '@prisma/client';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { PERMISSION_CATALOG } from '../src/permissions/permission-catalog';

// Concessão limitada (28/09/2026): ProfilesService passou a comparar o poder do chamador (lido do
// banco) com o dos perfis. Suítes que chamam o service direto com um chamador sintético (userId
// fictício) testam OUTRAS travas (último detentor, acesso total ao Ponto) — este stub dá ao chamador
// o catálogo inteiro no alcance máximo (como o Administrador Geral), mantendo a intenção delas. Os
// grants dos perfis continuam vindo do banco real.
export function fullPowerAuthorization(real: AuthorizationService): AuthorizationService {
  const everything: Record<string, Scope | null> = Object.fromEntries(
    PERMISSION_CATALOG.map((p) => [p.code, p.validScopes.includes(Scope.EMPRESA) ? Scope.EMPRESA : null]),
  );
  return {
    getEffectivePermissions: async () => everything,
    getProfileGrants: (companyId: string, profileId: string | null) => real.getProfileGrants(companyId, profileId),
  } as unknown as AuthorizationService;
}
