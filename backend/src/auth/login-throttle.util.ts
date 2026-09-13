// Tracker dedicado para o throttler nomeado "login-email" (ver
// auth.controller.ts) — extraído em função própria pra poder ser testado
// isoladamente (login-throttle.util.spec.ts) sem precisar montar um Nest
// ExecutionContext completo.
//
// Rastreia só pelo e-mail do corpo da requisição (nunca combinado com IP):
// é exatamente o oposto do tracker padrão do @nestjs/throttler (que é
// `req.ip`, usado pelo throttler "default" já existente nesta mesma rota).
// Ter os dois throttlers rodando em paralelo — "default" por IP e
// "login-email" só por e-mail — fecha as duas lacunas ao mesmo tempo: um
// IP variando de e-mail não esgota o bucket de outro e-mail (buckets
// diferentes), e um e-mail sendo atacado a partir de vários IPs diferentes
// esgota o MESMO bucket (mesma chave), porque o IP não faz parte da chave.
// Ver a spec do design (`docs/superpowers/specs/2026-09-11-auth-multitenant-design.md`,
// "rate limit... por IP e por e-mail") e [[DECISOES-TECNICAS]] no vault.
export function loginEmailTracker(req: Record<string, any>): string {
  const email = typeof req?.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined;
  // Fallback pro IP só se por algum motivo o corpo não tiver e-mail (ex.:
  // corpo malformado que ainda não passou pelo ValidationPipe, que só roda
  // depois dos guards) — nunca deixa o tracker resolver pra uma string vazia
  // que agruparia todo mundo sem e-mail num único bucket global.
  return email || req?.ip || 'unknown';
}
