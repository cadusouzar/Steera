// Fonte única do valor EFETIVO de `hasFullPontoAccess` exposto a qualquer caller (claim do JWT,
// objeto `user` de login/register/me, listagem de logins da empresa).
//
// Achado na revisão final de 15/09/2026: `User.hasFullPontoAccess` nasce `true` para TODA linha
// (`@default(true)` no schema) e `UsersService.create()` nunca sobrescreve isso para um login
// `EMPLOYEE` — então o JWT de um gerente EMPLOYEE carregava `hasFullPontoAccess: true`. O backend
// sempre exigiu `role === 'ADMIN' && hasFullPontoAccess` (ver
// TimeManagementAuthService.assertHasFullPontoAccess), mas o frontend lia o booleano cru, sem
// nenhuma checagem de papel — exatamente a persona deste módulo (um gerente EMPLOYEE com o módulo
// RH) entrava na tela administrativa achando que tinha acesso total e tomava 404 em toda mutação.
//
// Normalizando aqui, o booleano passa a significar a MESMA coisa dos dois lados do fio:
// `role === 'ADMIN' && flag` colapsa para "esse flag está true". Isto muda só o que é EXPOSTO —
// nunca a semântica da coluna no banco, nem a regra de `UsersService.updatePontoAccess()` (que
// continua exigindo `role === 'ADMIN'` no ALVO e mantendo a trava do último admin de acesso
// total).
export function effectiveHasFullPontoAccess(user: { role: string; hasFullPontoAccess: boolean }): boolean {
  // `=== true` (e não só o valor) pra sempre devolver um booleano de verdade, mesmo se o campo
  // vier ausente/nulo de alguma consulta parcial.
  return user.role === 'ADMIN' && user.hasFullPontoAccess === true;
}
