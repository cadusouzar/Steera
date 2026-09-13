import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SkipThrottle, Throttle, ThrottlerException, ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';
import { loginEmailTracker } from './login-throttle.util';

// Exercita o ThrottlerGuard de verdade (não um mock) com a MESMA
// configuração usada em auth.controller.ts/app.module.ts: dois throttlers
// nomeados, "default" (por IP, tracker padrão do pacote) e "login-email"
// (por e-mail, via loginEmailTracker). Prova o objetivo do fix: um atacante
// que faz brute-force de UM e-mail conhecido rotacionando IPs é pego pelo
// throttler "login-email" mesmo que cada IP individual nunca estoure o
// throttler "default" sozinho.
class FakeAuthController {
  @Throttle({
    default: { limit: 5, ttl: 900_000 },
    'login-email': { limit: 5, ttl: 900_000, getTracker: loginEmailTracker },
  })
  login() {
    return 'ok';
  }

  @SkipThrottle({ 'login-email': true })
  @Throttle({ default: { limit: 60, ttl: 900_000 } })
  refresh() {
    return 'ok';
  }
}

function makeContext(handlerName: 'login' | 'refresh', req: Record<string, any>): ExecutionContext {
  const handler = FakeAuthController.prototype[handlerName];
  return {
    getHandler: () => handler,
    getClass: () => FakeAuthController,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ header: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
}

async function buildGuard() {
  const options = [
    { name: 'default', ttl: 900_000, limit: 5 },
    { name: 'login-email', ttl: 900_000, limit: 5 },
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
});
