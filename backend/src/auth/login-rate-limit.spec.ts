import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { FriendlyThrottlerGuard } from './guards/friendly-throttler.guard';

// Exercita o throttler de verdade (não um mock) contra os handlers REAIS de AuthController (o
// @Throttle/@SkipThrottle deles é o que vale) e os mesmos throttlers nomeados de app.module.ts:
// "default" (por IP, ou pelo tracker do handler) e "login-email" (por e-mail).
//
// Fix round 1 ("Acesso e sessões", 26/09/2026): o login NÃO usa mais o throttler "login-email" —
// ele rodava antes do handler e contava login certo também. A trava por e-mail do login (só falhas)
// está em AuthService.login/UnknownLoginFailureTracker, coberta em auth.service.spec.ts.
type Handler = 'login' | 'refresh' | 'forgotPassword';

function makeContext(handlerName: Handler, req: Record<string, any>): ExecutionContext {
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
    { name: 'login-email', ttl: 900_000, limit: 5 },
  ];
  const guard = new FriendlyThrottlerGuard(options as any, new ThrottlerStorageService(), new Reflector());
  await guard.onModuleInit();
  return guard;
}

describe('rate limits de /auth (throttler real contra os handlers reais)', () => {
  it('login: o MESMO e-mail vindo de IPs diferentes nunca é barrado pelo throttler (logins certos não podem contar)', async () => {
    const guard = await buildGuard();
    for (let i = 0; i < 20; i++) {
      const req = { ip: `10.0.0.${i}`, body: { email: 'vitima@teste.com' }, headers: {} };
      await expect(guard.canActivate(makeContext('login', req))).resolves.toBe(true);
    }
  });

  it('login: limite por IP é 100/15min — a 101ª do mesmo IP é 429 com a mensagem amigável', async () => {
    const guard = await buildGuard();
    for (let i = 0; i < 100; i++) {
      const req = { ip: '10.9.9.9', body: { email: `u${i}@teste.com` }, headers: {} };
      await expect(guard.canActivate(makeContext('login', req))).resolves.toBe(true);
    }
    const last = { ip: '10.9.9.9', body: { email: 'u-final@teste.com' }, headers: {} };
    const err = await guard.canActivate(makeContext('login', last)).catch((e) => e);
    expect(err).toBeInstanceOf(ThrottlerException);
    expect(err.message).toBe('Muitas tentativas. Tente novamente em 15 minutos.');
  });

  it('forgot-password continua com o throttler por e-mail: 3/15min pro mesmo e-mail, mesmo trocando de IP', async () => {
    const guard = await buildGuard();
    for (let i = 0; i < 3; i++) {
      const req = { ip: `10.1.0.${i}`, body: { email: 'vitima@teste.com' }, headers: {} };
      await expect(guard.canActivate(makeContext('forgotPassword', req))).resolves.toBe(true);
    }
    const fourth = { ip: '10.1.0.99', body: { email: 'vitima@teste.com' }, headers: {} };
    await expect(guard.canActivate(makeContext('forgotPassword', fourth))).rejects.toBeInstanceOf(ThrottlerException);
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
