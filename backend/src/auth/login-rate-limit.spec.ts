import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { THROTTLERS } from '../app-throttlers';
import { TimeClockController } from '../time-clock/time-clock.controller';
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

// Mesma lista de throttlers nomeados registrada em app.module.ts (THROTTLERS).
const storages: ThrottlerStorageService[] = [];
async function buildGuard() {
  const storage = new ThrottlerStorageService();
  storages.push(storage);
  const guard = new FriendlyThrottlerGuard(THROTTLERS as any, storage, new Reflector());
  await guard.onModuleInit();
  return guard;
}

describe('rate limits de /auth (throttler real contra os handlers reais)', () => {
  // O storage agenda um setTimeout de 15min por chave — sem limpar, o Jest nunca sai sozinho.
  afterEach(() => {
    storages.splice(0).forEach((storage) => storage.onApplicationShutdown());
  });

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

  // Q2 (fix final): só por sessão, um cookie aleatório por requisição ganhava um bucket novo a cada
  // chamada — sem teto nenhum pra quem martela /auth/refresh com lixo. "refresh-ip" é um teto
  // secundário por IP (600/15min), bem acima do uso legítimo de um escritório inteiro.
  it('refresh: teto secundário por IP — 600 sessões aleatórias do mesmo IP passam, a 601ª é 429; outro IP segue livre', async () => {
    const guard = await buildGuard();
    for (let i = 0; i < 600; i++) {
      const req = { ip: '10.7.7.7', body: {}, headers: {}, cookies: { rt: `lixo-${i}` } };
      await expect(guard.canActivate(makeContext('refresh', req))).resolves.toBe(true);
    }
    const next = { ip: '10.7.7.7', body: {}, headers: {}, cookies: { rt: 'lixo-novo' } };
    const err = await guard.canActivate(makeContext('refresh', next)).catch((e) => e);
    expect(err).toBeInstanceOf(ThrottlerException);
    expect(err.message).toBe('Muitas tentativas. Tente novamente em 15 minutos.');

    const otherIp = { ip: '10.7.7.8', body: {}, headers: {}, cookies: { rt: 'lixo-novo' } };
    await expect(guard.canActivate(makeContext('refresh', otherIp))).resolves.toBe(true);
  });

  // Throttler nomeado vale em TODA rota com ThrottlerGuard que não o pule — "refresh-ip" só pode
  // valer em /auth/refresh.
  it.each([
    ['AuthController', AuthController],
    ['TimeClockController', TimeClockController],
  ])('%s: toda rota com throttler pula "refresh-ip", exceto refresh', (_name, controller) => {
    const proto = (controller as any).prototype;
    const throttled = Object.getOwnPropertyNames(proto).filter((name) => {
      if (name === 'constructor') return false;
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? [];
      return guards.includes(FriendlyThrottlerGuard);
    });
    expect(throttled.length).toBeGreaterThan(0);
    for (const name of throttled) {
      const skip = Reflect.getMetadata('THROTTLER:SKIPrefresh-ip', proto[name]);
      expect({ name, skip: skip === true }).toEqual({ name, skip: name !== 'refresh' });
    }
  });
});
