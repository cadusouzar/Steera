// Fonte única do valor EFETIVO de `hasFullPontoAccess` exposto a qualquer caller (claim do JWT,
// objeto `user` de login/register/me, listagem de logins da empresa).
//
// Achado na revisão final de 15/09/2026: `User.hasFullPontoAccess` nasce `true` para TODA linha
// (`@default(true)` no schema), e naquela época `UsersService.create()` nunca sobrescrevia isso
// para um login `EMPLOYEE` — então o JWT de um gerente EMPLOYEE carregava `hasFullPontoAccess:
// true`. O backend sempre exigiu `role === 'ADMIN' && hasFullPontoAccess` (ver
// TimeManagementAuthService.assertHasFullPontoAccess), mas o frontend lia o booleano cru, sem
// nenhuma checagem de papel — exatamente a persona deste módulo (um gerente EMPLOYEE com o módulo
// RH) entrava na tela administrativa achando que tinha acesso total e tomava 404 em toda mutação.
//
// Normalizando aqui, o booleano passa a significar a MESMA coisa dos dois lados do fio:
// `role === 'ADMIN' && flag` colapsa para "esse flag está true".
//
// Atualização (Fase 2a, 22/09/2026): `UsersService.create()` passou a derivar `hasFullPontoAccess`
// do Perfil escolhido pra QUALQUER login, `EMPLOYEE` incluído (sempre `true` na coluna crua pra um
// EMPLOYEE, já que `deriveHasFullPontoAccessFromGrants` nunca depende do papel) — a normalização
// aqui continua necessária pelo mesmo motivo de sempre. `UsersService.updatePontoAccess()` foi
// removido nesta mesma fase; a regra de nunca deixar a empresa sem nenhum ADMIN de acesso total
// agora vive em `assertOtherAdminGrantsFullPontoAccess`/`assertNotLastAdminWithFullPontoAccess`
// (`backend/src/users/last-permission-holder.util.ts`), acionadas por `UsersService.assignProfile()`
// e `ProfilesService.update()`/`reassignAndDelete()` — os únicos lugares que hoje podem mudar o
// valor efetivo deste campo, junto de `UsersService.create()`.
export function effectiveHasFullPontoAccess(user: { role: string; hasFullPontoAccess: boolean }): boolean {
  // `=== true` (e não só o valor) pra sempre devolver um booleano de verdade, mesmo se o campo
  // vier ausente/nulo de alguma consulta parcial.
  return user.role === 'ADMIN' && user.hasFullPontoAccess === true;
}
