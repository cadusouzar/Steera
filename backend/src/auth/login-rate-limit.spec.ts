import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';
import { AuthController } from './auth.controller';

// Exercita o ThrottlerGuard de verdade (não um mock) contra os handlers REAIS de AuthController
// (o @Throttle({...}) deles é o que vale) e os mesmos throttlers nomeados de app.module.ts:
// "default" (por IP, tracker padrão do pacote) e "login-email" (por e-mail, via
// loginEmailTracker). Prova o objetivo do fix: um atacante que faz brute-force de UM e-mail
// conhecido rotacionando IPs é pego pelo throttler "login-email" mesmo que cada IP individual
// nunca estoure o throttler "default" sozinho. (A resposta 403 anti-enumeração desse caso é
// coberta em guards/login-throttler.guard.spec.ts; aqui é o ThrottlerGuard base.)
function makeContext(handlerName: 'login' | 'refresh', req: Record<string, any>): ExecutionContext {
  const handler = AuthController.prototype[handlerName];
  return {
    getHandler: () => handler,
    getClass: () => AuthController,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ header: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
}

async function buildGuard() {
  const options = [
    { name: 'default', ttl: 900_000, limit: 5 },
    { name: 'login-email', ttl: 900_000, limit: 5, setHeaders: false },
  ];
  const storage = new ThrottlerStorageService();
  const guard = new ThrottlerGuard(options as any, storage, new Reflector());
  await guard.onModuleInit();
  return guard;
}

describe('login rate limiting (real ThrottlerGuard, "default" + "login-email")', () => {
  it('rate-limits the SAME email attacked from 6 different simulated IPs on the 6th attempt', async () => {
    const guard = await buildGuard();
    const email = 'vitima@teste.com';

    for (let i = 0; i < 5; i++) {
      const req = { ip: `10.0.0.${i}`, body: { email }, headers: {} };
      await expect(guard.canActivate(makeContext('login', req))).resolves.toBe(true);
    }

    const sixthReq = { ip: '10.0.0.5', body: { email }, headers: {} };
    await expect(guard.canActivate(makeContext('login', sixthReq))).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('does NOT rate-limit different emails coming from the same IP under the email tracker', async () => {
    const guard = await buildGuard();
    const sameIp = '10.0.0.100';

    // 5 different emails from the same IP: the "login-email" bucket never
    // repeats a key, so it never trips — even though this is the same
    // pattern of "5 requests" that would trip a same-key bucket.
    for (let i = 0; i < 5; i++) {
      const req = { ip: sameIp, body: { email: `user${i}@teste.com` }, headers: {} };
      await expect(guard.canActivate(makeContext('login', req))).resolves.toBe(true);
    }
  });

  it('refresh (no email in body, login-email throttler skipped) is unaffected by the email tracker', async () => {
    const guard = await buildGuard();
    // 6 refresh calls from the same IP, well under the 60/15min "default"
    // limit on refresh — none of these should touch the "login-email"
    // bucket at all (SkipThrottle), so no cross-user "undefined email"
    // bucket collision is possible.
    for (let i = 0; i < 6; i++) {
      const req = { ip: '10.0.0.1', body: {}, headers: {} };
      await expect(guard.canActivate(makeContext('refresh', req))).resolves.toBe(true);
    }
  });

  // Refresh por sessão (sha256 do cookie rt, ver refresh-throttle.util.ts), não por IP: um escritório
  // inteiro atrás de um IP não divide mais o mesmo bucket de 60/15min.
  it('refresh: 60 por sessão — a 61ª da mesma sessão é 429, outra sessão no mesmo IP segue livre', async () => {
    const guard = await buildGuard();
    for (let i = 0; i < 60; i++) {
      const req = { ip: '10.0.0.1', body: {}, headers: {}, cookies: { rt: 'sessao-a' } };
      await expect(guard.canActivate(makeContext('refresh', req))).resolves.toBe(true);
    }
    const sameSession = { ip: '10.0.0.2', body: {}, headers: {}, cookies: { rt: 'sessao-a' } };
    await expect(guard.canActivate(makeContext('refresh', sameSession))).rejects.toBeInstanceOf(ThrottlerException);

    const otherSession = { ip: '10.0.0.1', body: {}, headers: {}, cookies: { rt: 'sessao-b' } };
    await expect(guard.canActivate(makeContext('refresh', otherSession))).resolves.toBe(true);
  });
});
