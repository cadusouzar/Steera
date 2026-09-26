import { createHash } from 'crypto';

// Tracker do throttler "default" em POST /auth/refresh ("Acesso e sessões", 26/09/2026): por
// SESSÃO (sha256 do cookie `rt`), não por IP — antes, um escritório inteiro atrás do mesmo IP
// dividia um único bucket de 60/15min e um usuário recarregando muito derrubava a sessão dos
// colegas. O valor cru do cookie nunca vira chave (nem vai pro storage do throttler): só o hash.
// Sem cookie (requisição que vai dar 401 de qualquer jeito), cai no IP pra não juntar todo mundo
// sem cookie num bucket global. Extraída em função própria pra ser testada isoladamente
// (refresh-throttle.util.spec.ts), mesmo padrão de login-throttle.util.ts.
export function refreshSessionTracker(req: Record<string, any>): string {
  const cookie = req?.cookies?.rt;
  if (typeof cookie === 'string' && cookie.length > 0) {
    return 'rt:' + createHash('sha256').update(cookie).digest('hex');
  }
  return `ip:${req?.ip ?? 'unknown'}`;
}
