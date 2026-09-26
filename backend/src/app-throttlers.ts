import { ThrottlerOptions } from '@nestjs/throttler';

// Throttlers nomeados registrados em ThrottlerModule.forRoot (app.module.ts). Numa lista própria pra
// o teste do throttler real (auth/login-rate-limit.spec.ts) usar EXATAMENTE a mesma configuração.
//
// Todo throttler nomeado vale em TODA rota que roda o ThrottlerGuard, a menos que a rota o pule com
// @SkipThrottle({ nome: true }) — por isso "login-email" e "refresh-ip" são pulados em todas as rotas
// que não os usam (ver auth.controller.ts e time-clock.controller.ts). O limite/ttl usado em runtime
// vem do @Throttle({...}) de cada handler; os valores aqui são só o mínimo pro nome existir.
//
// - "default": por IP (ou pelo tracker do handler), limite de cada rota.
// - "login-email": por e-mail, só em POST /auth/forgot-password.
// - "refresh-ip" (fix final de "Acesso e sessões"): teto SECUNDÁRIO por IP só em POST
//   /auth/refresh. O "default" de lá é por sessão (sha256 do cookie rt), então um cookie aleatório
//   por requisição ganhava um bucket novo a cada chamada — sem teto nenhum. 600/15min por IP fica bem
//   acima do uso legítimo de um escritório inteiro atrás de um NAT.
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: 900_000, limit: 5 },
  { name: 'login-email', ttl: 900_000, limit: 5 },
  { name: 'refresh-ip', ttl: 900_000, limit: 600 },
];
