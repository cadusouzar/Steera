import { ExecutionContext, ForbiddenException, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerLimitDetail, ThrottlerStorageService } from '@nestjs/throttler';
import { accountLockedError } from '../account-lock.util';
import { AuthController } from '../auth.controller';
import { loginEmailTracker } from '../login-throttle.util';
import { LoginThrottlerGuard } from './login-throttler.guard';

// Contexto apontando pro handler REAL de AuthController.login — assim o @Throttle({...}) de
// verdade (limites, blockDuration, getTracker por e-mail) é o que está sendo exercitado.
// Mesmos throttlers nomeados de app.module.ts.
const THROTTLER_OPTIONS = [
  { name: 'default', ttl: 900_000, limit: 5 },
  { name: 'login-email', ttl: 900_000, limit: 5, setHeaders: false },
];

function makeContext(req: Record<string, any>, res: Record<string, any> = { header: jest.fn() }): ExecutionContext {
  return {
    getHandler: () => AuthController.prototype.login,
    getClass: () => AuthController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

// Expõe o método protegido pra exercitá-lo direto, sem storage.
class TestableLoginThrottlerGuard extends LoginThrottlerGuard {
  callThrow(context: ExecutionContext, detail: ThrottlerLimitDetail) {
    return this.throwThrottlingException(context, detail);
  }
}

function detail(tracker: string, timeToBlockExpire = 600): ThrottlerLimitDetail {
  return { limit: 5, ttl: 900_000, key: 'k', tracker, totalHits: 6, timeToExpire: 600, isBlocked: true, timeToBlockExpire };
}

async function buildGuard<T extends LoginThrottlerGuard>(Ctor: new (...args: any[]) => T): Promise<T> {
  const guard = new Ctor(THROTTLER_OPTIONS as any, new ThrottlerStorageService(), new Reflector());
  await guard.onModuleInit();
  return guard;
}

describe('LoginThrottlerGuard.throwThrottlingException', () => {
  it('quando quem estourou foi o throttler por e-mail → 403 ACCOUNT_TEMPORARILY_LOCKED', async () => {
    const guard = await buildGuard(TestableLoginThrottlerGuard);
    const req = { ip: '1.2.3.4', body: { email: ' Vitima@Teste.com ' } };

    const err = await guard.callThrow(makeContext(req), detail(loginEmailTracker(req), 600)).catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toEqual({
      statusCode: 403,
      code: 'ACCOUNT_TEMPORARILY_LOCKED',
      retryAfterSeconds: 600,
      message: 'Muitas tentativas para esta conta. Tente novamente em 10 minutos ou redefina sua senha pelo e-mail.',
    });
  });

  it('quando quem estourou foi o throttler por IP → 429 com a mensagem amigável de sempre', async () => {
    const guard = await buildGuard(TestableLoginThrottlerGuard);
    const req = { ip: '1.2.3.4', body: { email: 'vitima@teste.com' } };

    const err = await guard.callThrow(makeContext(req), detail('1.2.3.4', 600)).catch((e) => e);

    expect(err).toBeInstanceOf(ThrottlerException);
    expect(err.getStatus()).toBe(429);
    expect(err.message).toBe('Muitas tentativas. Tente novamente em 10 minutos.');
  });

  it('corpo sem e-mail (tracker de e-mail cai no IP) nunca vira 403 de conta', async () => {
    const guard = await buildGuard(TestableLoginThrottlerGuard);
    const req = { ip: '1.2.3.4', body: {} };

    const err = await guard.callThrow(makeContext(req), detail('1.2.3.4')).catch((e) => e);

    expect(err).toBeInstanceOf(ThrottlerException);
  });
});

describe('LoginThrottlerGuard com ThrottlerGuard real (anti-enumeração)', () => {
  it('e-mail inventado: 5 tentativas passam, a 6ª recebe EXATAMENTE a mesma resposta que uma conta real travada', async () => {
    const guard = await buildGuard(LoginThrottlerGuard);
    const email = 'nao-existe@teste.com';

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(makeContext({ ip: `10.0.0.${i}`, body: { email } }))).resolves.toBe(true);
    }
    const res = { header: jest.fn() };
    const err: HttpException = await guard
      .canActivate(makeContext({ ip: '10.0.0.9', body: { email } }, res))
      .catch((e) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    const body = err.getResponse() as Record<string, any>;
    // Mesmo formato (chaves, status, code, mensagem) do bloqueio de conta real (AuthService.login).
    const real = accountLockedError(body.retryAfterSeconds).getResponse();
    expect(body).toEqual(real);
    expect(Object.keys(body).sort()).toEqual(['code', 'message', 'retryAfterSeconds', 'statusCode']);
    expect(body.retryAfterSeconds).toBe(900);
    expect(body.message).toBe(
      'Muitas tentativas para esta conta. Tente novamente em 15 minutos ou redefina sua senha pelo e-mail.',
    );
    // O throttler "login-email" não põe cabeçalho próprio (setHeaders: false) — um bloqueio de conta
    // real (vindo do AuthService, depois do guard) não teria esse cabeçalho, então ele denunciaria
    // qual dos dois caminhos respondeu.
    const headerNames = res.header.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(headerNames.some((h) => h.toLowerCase().includes('login-email'))).toBe(false);
  });

  it('limite por IP é 100/15min: 100 tentativas com e-mails diferentes passam, a 101ª é 429', async () => {
    const guard = await buildGuard(LoginThrottlerGuard);

    for (let i = 0; i < 100; i++) {
      await expect(guard.canActivate(makeContext({ ip: '10.9.9.9', body: { email: `u${i}@teste.com` } }))).resolves.toBe(true);
    }
    await expect(
      guard.canActivate(makeContext({ ip: '10.9.9.9', body: { email: 'u-final@teste.com' } })),
    ).rejects.toBeInstanceOf(ThrottlerException);
  });
});
