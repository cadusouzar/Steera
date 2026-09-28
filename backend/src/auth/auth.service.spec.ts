import { BadRequestException, ConflictException, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from '../authorization/authorization.service';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthService, FORGOT_PASSWORD_MESSAGE, LOCK_DURATION_MS } from './auth.service';
import { UserTokensService } from './user-tokens/user-tokens.service';
import { InviteMailer } from './user-tokens/invite-mailer';
import { accountLockedError } from './account-lock.util';
import { UnknownLoginFailureTracker } from './unknown-login-failures';
import * as passwordUtil from './password.util';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  let authorization: any;
  let email: { send: jest.Mock };
  let userTokens: { issue: jest.Mock; consume: jest.Mock; hasRecentPending: jest.Mock };
  const fakeRes = { cookie: jest.fn(), clearCookie: jest.fn() } as any;
  // E-mails (aviso de trava, esqueci minha senha) saem em segundo plano, sem a resposta esperar por
  // eles (anti-enumeração por latência) — os testes que olham o envio esperam a fila esvaziar.
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  // Promise que nunca resolve: simula um provedor de e-mail/banco travado.
  const never = () => new Promise<never>(() => undefined);
  const settlesQuickly = (p: Promise<unknown>) =>
    Promise.race([p.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('hung'), 200))]);

  // Cadastro ampliado (Task 5): shape completo do novo RegisterDto, usado como base por TODA
  // chamada de service.register(...) deste arquivo (a antiga { companyName, email, password } não
  // valida mais). CNPJ/telefone/CEP com máscara de propósito — normalizeDocument/normalizePhone
  // fazem a normalização dentro do service, não o DTO/mock.
  const baseRegisterDto = {
    personType: 'PJ' as const,
    document: '11.222.333/0001-81',
    legalName: 'Padaria Central Comércio de Alimentos Ltda',
    tradeName: 'Padaria Central',
    phone: '(11) 98765-4321',
    zipCode: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    name: 'Carlos Eduardo',
    email: 'a@b.com',
    password: 'senha12345678',
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn() },
      refreshToken: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      // Suporta os dois estilos de $transaction usados neste service:
      // callback (register()) e array (changePassword(), espelhando
      // UsersService.block()).
      $transaction: jest.fn((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
      // Called by runAsSystem/runTenantInteractiveTransaction (register()) to
      // set the RLS bypass session var before running the callback — see
      // tenant-rls.extension.ts. Not exercised by any assertion in this file
      // (these tests never set up a real ALS tenant context), just needs to
      // exist so `tx.$executeRaw` doesn't blow up as `undefined()`.
      $executeRaw: jest.fn(),
      // Task 7: CREATE SCHEMA / SET LOCAL search_path and the raw statements
      // inside every real tenant-migrations/*/migration.sql file (applyMigrations
      // reads real files from disk even in this unit test — only the actual SQL
      // execution and the TenantMigration bookkeeping row are mocked here).
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      // Task 5 (cadastro ampliado): pickCompanyIdentity confere disponibilidade do schemaName via
      // company.findUnique (Company já cadastrada) e $queryRaw (schema órfão no Postgres) — ambos
      // livres por padrão nestes testes, que não exercitam colisão (coberta em
      // schema-name-picker.util.spec.ts).
      $queryRaw: jest.fn().mockResolvedValue([]),
      tenantMigration: { create: jest.fn().mockResolvedValue({}) },
      company: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      employee: { findFirst: jest.fn() },
      // Task 7: Profile do fundador ("Administrador Geral") criado dentro da mesma transação de
      // register(), antes de tx.user.create().
      profile: { create: jest.fn() },
    };
    authorization = { getEffectivePermissions: jest.fn().mockResolvedValue({}) };
    email = { send: jest.fn().mockResolvedValue(true) };
    userTokens = {
      issue: jest.fn().mockResolvedValue('raw-reset-token'),
      consume: jest.fn(),
      hasRecentPending: jest.fn().mockResolvedValue(false),
    };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn(() => 'signed.jwt.token') } },
        { provide: AuthorizationService, useValue: authorization },
        { provide: EmailService, useValue: email },
        { provide: UserTokensService, useValue: userTokens },
        // Real (não mock): depende só de UserTokensService/EmailService, já mockados acima.
        InviteMailer,
        // Instância nova por teste: a trava em memória de e-mail inexistente nunca vaza entre testes.
        { provide: UnknownLoginFailureTracker, useValue: new UnknownLoginFailureTracker() },
      ],
    }).compile();
    service = module.get(AuthService);
    jwtService = module.get(JwtService);
    // jest.clearAllMocks() só zera calls/results, não a implementação (mockResolvedValue) —
    // mesmo comportamento do qual jwtService.sign acima já dependia antes desta task.
    jest.clearAllMocks();
  });

  it('login rejects a non-existent user with a generic message', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login({ email: 'x@x.com', password: 'y' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Auditoria de segurança (17/09/2026): a mensagem passou a ser específica (403, não mais o 401
  // genérico) — mas só depois de confirmar a senha certa, nunca antes (ver os testes de
  // "não revela" mais abaixo).
  it('login rejects a blocked user with a specific 403 message, once the password is confirmed', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'BLOCKED', passwordHash: 'h', failedLoginAttempts: 0 });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    await expect(service.login({ email: 'x@x.com', password: 'y' }, fakeRes)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.login({ email: 'x@x.com', password: 'y' }, fakeRes)).rejects.toThrow(/procure um administrador/i);
  });

  it('login rejects an incorrect password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE', passwordHash: 'h', failedLoginAttempts: 0 });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    await expect(service.login({ email: 'x@x.com', password: 'errada' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Bloqueio temporário por conta ("Acesso e sessões", 26/09/2026): substitui o LOCKED permanente
  // (que só um admin destravava) por lockedUntil = agora + 15min, que expira sozinho. Fix round 1:
  // só tentativa ERRADA conta (o throttler "login-email", que contava login certo também, saiu do
  // login), o contador é atualizado atomicamente, e e-mail sem conta tem uma trava em memória
  // idêntica (UnknownLoginFailureTracker).
  describe('login — bloqueio temporário por conta', () => {
    const activeUser = (overrides: Record<string, unknown> = {}) => ({
      id: 'u1', companyId: 'c1', email: 'vitima@teste.com', role: 'ADMIN', modules: ['DASHBOARD'],
      status: 'ACTIVE', passwordHash: 'h', mustChangePassword: false, hasFullPontoAccess: true,
      failedLoginAttempts: 0, lockedUntil: null as Date | null, ...overrides,
    });

    // Linha de User "de verdade" em memória: findUnique devolve uma cópia do estado atual e
    // updateMany/update aplicam os mesmos filtros/efeitos que o Postgres aplicaria (o UPDATE
    // reavalia o WHERE contra a versão atual da linha — é isso que torna o contador atômico).
    function installUserRow(initial: ReturnType<typeof activeUser>) {
      const row = { ...initial };
      const lockFree = (or: any[] | undefined) =>
        !or ||
        or.some(
          (cond) =>
            (cond.lockedUntil === null && row.lockedUntil === null) ||
            (cond.lockedUntil?.lte && row.lockedUntil !== null && row.lockedUntil <= cond.lockedUntil.lte),
        );
      const matches = (where: any) =>
        where.id === row.id &&
        (!where.status?.in || where.status.in.includes(row.status)) &&
        (where.failedLoginAttempts?.gte === undefined || row.failedLoginAttempts >= where.failedLoginAttempts.gte) &&
        lockFree(where.OR);
      const apply = (data: any) => {
        for (const [k, v] of Object.entries(data)) {
          (row as any)[k] = v && typeof v === 'object' && 'increment' in (v as any) ? (row as any)[k] + (v as any).increment : v;
        }
      };
      prisma.user.findUnique.mockImplementation(async () => ({ ...row }));
      prisma.user.updateMany.mockImplementation(async ({ where, data }: any) => {
        if (!matches(where)) return { count: 0 };
        apply(data);
        return { count: 1 };
      });
      prisma.user.update.mockImplementation(async ({ where, data }: any) => {
        if (where.id !== row.id) throw new Error('not found');
        apply(data);
        return { ...row };
      });
      return row;
    }

    const attempt = (password: string, emailAddr = 'vitima@teste.com') =>
      service.login({ email: emailAddr, password }, fakeRes).catch((e) => e);

    it('na 5ª senha errada seguida trava por 15min (status continua ACTIVE), zera o contador, manda e-mail e responde o 401 genérico', async () => {
      const row = installUserRow(activeUser({ failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
      const before = Date.now();

      const err = await attempt('errada');
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('E-mail ou senha inválidos');
      await flush();

      expect(row.status).toBe('ACTIVE');
      expect(row.failedLoginAttempts).toBe(0);
      expect(row.lockedUntil!.getTime()).toBeGreaterThanOrEqual(before + LOCK_DURATION_MS);
      expect(row.lockedUntil!.getTime()).toBeLessThanOrEqual(Date.now() + LOCK_DURATION_MS);
      expect(LOCK_DURATION_MS).toBe(15 * 60_000);

      expect(userTokens.issue).toHaveBeenCalledWith('u1', 'PASSWORD_RESET');
      expect(email.send).toHaveBeenCalledTimes(1);
      const [message, context] = email.send.mock.calls[0];
      expect(message.to).toBe('vitima@teste.com');
      expect(message.subject).toMatch(/bloqueada temporariamente/i);
      expect(message.html).toContain('raw-reset-token');
      expect(context).toBe('account-locked');
    });

    it('trava com um link de redefinição emitido há menos de 5min → trava, mas não emite token nem manda e-mail', async () => {
      const row = installUserRow(activeUser({ failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
      userTokens.hasRecentPending.mockResolvedValue(true);

      const err = await attempt('errada');
      expect(err).toBeInstanceOf(UnauthorizedException);
      await flush();

      expect(row.lockedUntil).not.toBeNull();
      expect(userTokens.hasRecentPending).toHaveBeenCalledWith('u1', 'PASSWORD_RESET', 5 * 60_000);
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('o incremento é condicional e atômico (updateMany com increment, só fora de trava ativa)', async () => {
      installUserRow(activeUser({ failedLoginAttempts: 1 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);

      await attempt('errada');

      const [first] = prisma.user.updateMany.mock.calls[0];
      expect(first.where).toEqual({
        id: 'u1',
        status: { in: ['ACTIVE', 'LOCKED'] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: expect.any(Date) } }],
      });
      expect(first.data).toEqual({ failedLoginAttempts: { increment: 1 } });
    });

    it('duas senhas erradas SIMULTÂNEAS com o contador em 4: só a requisição que cruzou o limite trava e manda o e-mail', async () => {
      const row = installUserRow(activeUser({ failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);

      const [a, b] = await Promise.all([attempt('errada'), attempt('errada')]);
      await flush();

      expect(a).toBeInstanceOf(UnauthorizedException);
      expect(b).toBeInstanceOf(UnauthorizedException);
      expect(row.lockedUntil).not.toBeNull();
      expect(email.send).toHaveBeenCalledTimes(1);
      expect(userTokens.issue).toHaveBeenCalledTimes(1);
    });

    it('falha ao emitir o token do e-mail de aviso nunca troca o 401 genérico por outro erro', async () => {
      const row = installUserRow(activeUser({ failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
      userTokens.issue.mockRejectedValue(new Error('db down'));
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const err = await attempt('errada');
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('E-mail ou senha inválidos');
      await flush();
      expect(row.lockedUntil).not.toBeNull();
      expect(email.send).not.toHaveBeenCalled();
      // Pego e logado (por userId/contexto), nunca uma unhandled rejection.
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toContain('account-locked');
      expect(logError.mock.calls[0][0]).toContain('u1');
      logError.mockRestore();
    });

    it('o 401 da 5ª tentativa não espera o e-mail de aviso (provedor travado não segura a resposta)', async () => {
      installUserRow(activeUser({ failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
      email.send.mockImplementation(never);

      await expect(settlesQuickly(attempt('errada'))).resolves.toBe('settled');
      await flush();
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('envio do aviso rejeitado é pego e logado sem nunca vazar o token', async () => {
      installUserRow(activeUser({ failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
      email.send.mockRejectedValue(new Error('smtp down'));
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(attempt('errada')).resolves.toBeInstanceOf(UnauthorizedException);
      await flush();
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).not.toContain('raw-reset-token');
      logError.mockRestore();
    });

    it('senha errada antes da 5ª só incrementa o contador, sem trava e sem e-mail', async () => {
      const row = installUserRow(activeUser({ failedLoginAttempts: 1 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);

      await expect(attempt('errada')).resolves.toEqual(new UnauthorizedException('E-mail ou senha inválidos'));
      expect(row.failedLoginAttempts).toBe(2);
      expect(row.lockedUntil).toBeNull();
      expect(email.send).not.toHaveBeenCalled();
      expect(userTokens.issue).not.toHaveBeenCalled();
    });

    it('conta travada (lockedUntil no futuro) + senha CERTA → 403 ACCOUNT_TEMPORARILY_LOCKED, sem checar a senha nem escrever nada', async () => {
      installUserRow(activeUser({ lockedUntil: new Date(Date.now() + 10 * 60_000) }));
      const verify = jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);

      const err = await attempt('certa');

      expect(err).toBeInstanceOf(ForbiddenException);
      const body = err.getResponse();
      expect(body.statusCode).toBe(403);
      expect(body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
      expect(body.retryAfterSeconds).toBeLessThanOrEqual(600);
      expect(body.message).toBe(
        'Muitas tentativas para esta conta. Tente novamente em 10 minutos ou redefina sua senha pelo e-mail.',
      );
      expect(verify).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('anti-enumeração: 6 tentativas erradas numa conta real e num e-mail inventado dão as MESMAS respostas (1-5: 401, 6ª: 403 idêntico)', async () => {
      installUserRow(activeUser());
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
      const real: any[] = [];
      for (let i = 0; i < 6; i++) real.push(await attempt('errada'));

      prisma.user.findUnique.mockResolvedValue(null);
      const fake: any[] = [];
      for (let i = 0; i < 6; i++) fake.push(await attempt('errada', 'Nao-Existe@teste.com'));

      for (let i = 0; i < 5; i++) {
        expect(real[i]).toBeInstanceOf(UnauthorizedException);
        expect(fake[i]).toBeInstanceOf(UnauthorizedException);
        expect(fake[i].getResponse()).toEqual(real[i].getResponse());
      }
      expect(real[5]).toBeInstanceOf(ForbiddenException);
      expect(fake[5]).toBeInstanceOf(ForbiddenException);
      expect(fake[5].constructor).toBe(real[5].constructor);
      expect(fake[5].getStatus()).toBe(real[5].getStatus());
      expect(fake[5].getResponse()).toEqual(real[5].getResponse());
      expect(real[5].getResponse()).toEqual(accountLockedError(900).getResponse());
    });

    it('e-mail inventado travado continua 403 mesmo com qualquer senha', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      for (let i = 0; i < 5; i++) await attempt('x', 'fake@teste.com');
      const err = await attempt('outra', 'fake@teste.com');
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    });

    // Q5: a busca da conta real é por igualdade EXATA do e-mail (findUnique, sem transform no
    // LoginDto). Se a chave do e-mail inventado fosse minúscula/aparada, travar "VITIMA@..." (que não
    // acha conta) e depois testar "vitima@..." distinguiria conta real (401, contador próprio) de
    // e-mail inexistente (403). A chave tem a mesma semântica da busca.
    it('a chave do e-mail inventado é exatamente o e-mail enviado (mesma semântica da busca da conta)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      for (let i = 0; i < 5; i++) await attempt('x', 'FAKE@teste.com');
      await expect(attempt('x', 'fake@teste.com')).resolves.toBeInstanceOf(UnauthorizedException);
      await expect(attempt('x', 'FAKE@teste.com')).resolves.toBeInstanceOf(ForbiddenException);
    });

    it('login CERTO nunca conta: 6 logins seguidos com a senha certa entram todos', async () => {
      const row = installUserRow(activeUser());
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      for (let i = 0; i < 6; i++) {
        const result = await service.login({ email: 'vitima@teste.com', password: 'certa' }, fakeRes);
        expect(result.accessToken).toBe('signed.jwt.token');
      }
      expect(row.failedLoginAttempts).toBe(0);
      expect(row.lockedUntil).toBeNull();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('lockedUntil já expirado + senha certa → login ok, zera contador e lockedUntil', async () => {
      installUserRow(activeUser({ lockedUntil: new Date(Date.now() - 60_000) }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      const result = await service.login({ email: 'vitima@teste.com', password: 'certa' }, fakeRes);

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });

    it('lockedUntil já expirado + senha errada → volta a contar do zero (a trava vencida não trava de novo sozinha)', async () => {
      const row = installUserRow(activeUser({ lockedUntil: new Date(Date.now() - 60_000), failedLoginAttempts: 0 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);

      const err = await attempt('errada');
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(row.failedLoginAttempts).toBe(1);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('status legado LOCKED + senha certa → login ok (tratado como ACTIVE, volta a ACTIVE no banco)', async () => {
      installUserRow(activeUser({ status: 'LOCKED', failedLoginAttempts: 5 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      const result = await service.login({ email: 'vitima@teste.com', password: 'certa' }, fakeRes);

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { failedLoginAttempts: 0, lockedUntil: null, status: 'ACTIVE' },
      });
    });

    it('status legado LOCKED + senha errada continua contando (e trava temporariamente na 5ª)', async () => {
      const row = installUserRow(activeUser({ status: 'LOCKED', failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);

      await expect(attempt('errada')).resolves.toBeInstanceOf(UnauthorizedException);
      await flush();
      expect(row.failedLoginAttempts).toBe(0);
      expect(row.lockedUntil).not.toBeNull();
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('BLOCKED + senha certa → mensagem de admin inalterada', async () => {
      installUserRow(activeUser({ status: 'BLOCKED' }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);

      const err = await attempt('certa');
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.message).toBe('Seu login foi bloqueado. Procure um administrador da sua empresa.');
    });

    it('BLOCKED + senha errada não acumula tentativas (só ACTIVE/LOCKED contam)', async () => {
      const row = installUserRow(activeUser({ status: 'BLOCKED', failedLoginAttempts: 4 }));
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);

      await expect(attempt('errada')).resolves.toBeInstanceOf(UnauthorizedException);
      expect(row.failedLoginAttempts).toBe(4);
      expect(row.lockedUntil).toBeNull();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('INVITED + qualquer senha (mesmo a "certa") → 401 genérico, nunca contra o hash do login, sem tocar no banco', async () => {
      const row = installUserRow(activeUser({ status: 'INVITED', failedLoginAttempts: 4, passwordHash: 'hash-do-convite' }));
      const verify = jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);

      const err = await attempt('qualquer');
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toBe('E-mail ou senha inválidos');
      // I1: roda um verify "de mentira" (hash fixo do processo) pra latência bater com a de uma
      // conta real — nunca contra o hash do próprio login.
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0][0]).not.toBe('hash-do-convite');
      expect(row.failedLoginAttempts).toBe(4);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    // I1: antes, senha errada só contava pra ACTIVE/LOCKED — INVITED/BLOCKED nunca travavam, então
    // 6 senhas erradas davam 401×6 nelas e 401×5+403 numa conta real/e-mail inventado: dava pra
    // descobrir que o e-mail tinha um login convidado/bloqueado. Agora caem na MESMA trava em memória
    // do e-mail inventado.
    const sixWrong = async (emailAddr: string) => {
      const out: any[] = [];
      for (let i = 0; i < 6; i++) out.push(await attempt('errada', emailAddr));
      return out;
    };
    const expectSameSequence = (actual: any[], reference: any[]) => {
      for (let i = 0; i < 5; i++) {
        expect(actual[i]).toBeInstanceOf(UnauthorizedException);
        expect(actual[i].getResponse()).toEqual(reference[i].getResponse());
      }
      expect(actual[5]).toBeInstanceOf(ForbiddenException);
      expect(actual[5].getStatus()).toBe(reference[5].getStatus());
      expect(actual[5].getResponse()).toEqual(reference[5].getResponse());
      expect(actual[5].getResponse()).toEqual(accountLockedError(900).getResponse());
    };

    it.each(['INVITED', 'BLOCKED'])(
      'anti-enumeração: %s dá 401×5 e depois o MESMO 403 ACCOUNT_TEMPORARILY_LOCKED de uma conta real e de um e-mail inventado',
      async (status) => {
        const verify = jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
        installUserRow(activeUser());
        const real = await sixWrong('vitima@teste.com');

        prisma.user.findUnique.mockResolvedValue(null);
        const unknown = await sixWrong('nao-existe@teste.com');

        installUserRow(activeUser({ id: 'u9', email: 'outro@teste.com', status }));
        verify.mockClear();
        const other = await sixWrong('outro@teste.com');

        expectSameSequence(unknown, real);
        expectSameSequence(other, real);
        // Um verify por tentativa que chegou a conferir senha (as 5 primeiras; a 6ª já sai no 403).
        expect(verify).toHaveBeenCalledTimes(5);
      },
    );

    it('BLOCKED travado pela trava em memória: nem a senha certa entra (403 da trava, não a mensagem de admin)', async () => {
      installUserRow(activeUser({ status: 'BLOCKED' }));
      const verify = jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
      for (let i = 0; i < 5; i++) await attempt('errada');
      verify.mockResolvedValue(true);
      const err = await attempt('certa');
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    });

    it('verifyPassword roda em TODO caminho de senha (conta ativa, e-mail inventado, INVITED, BLOCKED)', async () => {
      const verify = jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);

      installUserRow(activeUser());
      await attempt('errada');
      expect(verify).toHaveBeenCalledTimes(1);

      prisma.user.findUnique.mockResolvedValue(null);
      await attempt('errada', 'nao-existe@teste.com');
      expect(verify).toHaveBeenCalledTimes(2);

      installUserRow(activeUser({ status: 'INVITED' }));
      await attempt('errada');
      expect(verify).toHaveBeenCalledTimes(3);

      installUserRow(activeUser({ status: 'BLOCKED' }));
      await attempt('errada');
      expect(verify).toHaveBeenCalledTimes(4);

      // O verify do e-mail inventado e do INVITED usa o hash "de mentira" do processo, nunca 'h'.
      expect(verify.mock.calls[1][0]).not.toBe('h');
      expect(verify.mock.calls[2][0]).not.toBe('h');
      expect(verify.mock.calls[1][0]).toBe(verify.mock.calls[2][0]);
      expect(verify.mock.calls[3][0]).toBe('h');
    });
  });

  it('login never reveals a blocked/locked account status to a wrong password (no ForbiddenException, always the generic message)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'BLOCKED', passwordHash: 'h', failedLoginAttempts: 0 });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    const rejection = service.login({ email: 'x@x.com', password: 'errada' }, fakeRes);
    await expect(rejection).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(rejection).rejects.not.toBeInstanceOf(ForbiddenException);
  });

  it('login resets the failed-attempt counter to 0 on a successful login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['DASHBOARD'], status: 'ACTIVE',
      passwordHash: 'h', mustChangePassword: false, hasFullPontoAccess: true, failedLoginAttempts: 3,
    });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

    await service.login({ email: 'x@x.com', password: 'certa' }, fakeRes);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  });

  it('login does not write to the database when the counter is already 0 on a successful login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['DASHBOARD'], status: 'ACTIVE',
      passwordHash: 'h', mustChangePassword: false, hasFullPontoAccess: true, failedLoginAttempts: 0,
    });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

    await service.login({ email: 'x@x.com', password: 'certa' }, fakeRes);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('signs hasFullPontoAccess into the access token payload', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['DASHBOARD'], status: 'ACTIVE',
      passwordHash: 'h', mustChangePassword: false, hasFullPontoAccess: true,
    });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

    const result = await service.login({ email: 'x@x.com', password: 'y' }, fakeRes);

    expect(result.accessToken).toBe('signed.jwt.token');
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ hasFullPontoAccess: true }),
      expect.anything(),
    );
    expect(result.user.hasFullPontoAccess).toBe(true);
  });

  // Task 4 (26/09/2026): mock antigo, sem `company` nenhum na linha (nenhuma include de
  // planTier) — toPublicUser precisa devolver `plan: null` em vez de lançar, pra nunca quebrar um
  // teste/call site que ainda não foi atualizado pra incluir a relação.
  it('login exposes plan: null when the mocked user row has no company (planTier ausente)', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['DASHBOARD'], status: 'ACTIVE',
      passwordHash: 'h', mustChangePassword: false, hasFullPontoAccess: true,
    });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

    const result = await service.login({ email: 'x@x.com', password: 'y' }, fakeRes);

    expect(result.user.plan).toBeNull();
  });

  // Achado C2 da revisão final (15/09/2026): `User.hasFullPontoAccess` nasce `true` pra TODA linha
  // (@default(true) no schema) e UsersService.create() nunca desliga isso pra um login EMPLOYEE —
  // então o JWT de um gerente EMPLOYEE carregava `true`, o frontend lia o booleano cru sem
  // nenhuma checagem de papel, e essa persona (a razão de ser deste plano) entrava na tela
  // administrativa achando ter acesso total e tomava 404 em toda mutação. O valor exposto agora é
  // sempre o EFETIVO (role === 'ADMIN' && flag).
  it('login exposes hasFullPontoAccess: false for an EMPLOYEE login even when the stored column is true', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u2', companyId: 'c1', role: 'EMPLOYEE', modules: ['RH'], status: 'ACTIVE',
      passwordHash: 'h', mustChangePassword: false, hasFullPontoAccess: true, employeeId: 'emp-1',
    });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

    const result = await service.login({ email: 'gerente@x.com', password: 'y' }, fakeRes);

    expect(result.user.hasFullPontoAccess).toBe(false);
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ hasFullPontoAccess: false, role: 'EMPLOYEE' }),
      expect.anything(),
    );
  });

  it('getProfile (GET /auth/me) exposes hasFullPontoAccess: false for an EMPLOYEE login', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'u2', email: 'gerente@x.com', companyId: 'c1', role: 'EMPLOYEE', modules: ['RH'],
      mustChangePassword: false, employeeId: 'emp-1', hasFullPontoAccess: true, passwordHash: 'h',
    });

    const profile = await service.getProfile('u2');

    expect(profile.hasFullPontoAccess).toBe(false);
    // Nunca vaza o row cru do Prisma (sem passwordHash na resposta).
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('getProfile keeps hasFullPontoAccess: false for an ADMIN whose column is false (restricted admin)', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'u3', email: 'admin-restrito@x.com', companyId: 'c1', role: 'ADMIN', modules: ['RH'],
      mustChangePassword: false, employeeId: 'emp-2', hasFullPontoAccess: false, passwordHash: 'h',
    });

    expect((await service.getProfile('u3')).hasFullPontoAccess).toBe(false);
  });

  it('refresh signs the EFFECTIVE flag for an EMPLOYEE login as well', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', userId: 'u2', expiresAt: new Date(Date.now() + 10_000), revokedAt: null, replacedByTokenId: null,
      user: { id: 'u2', companyId: 'c1', role: 'EMPLOYEE', modules: ['RH'], status: 'ACTIVE', hasFullPontoAccess: true },
    });
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt2' });

    await service.refresh('algum-valor', fakeRes);

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ hasFullPontoAccess: false }),
      expect.anything(),
    );
  });

  it('refresh rejects when no cookie value is provided', async () => {
    await expect(service.refresh(undefined, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh rejects and revokes the whole family when a replaced token is reused', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', userId: 'u1', expiresAt: new Date(Date.now() + 10_000), revokedAt: null, replacedByTokenId: 'rt2', user: { status: 'ACTIVE' },
    });
    await expect(service.refresh('algum-valor', fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('refresh rejects an expired token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', userId: 'u1', expiresAt: new Date(Date.now() - 10_000), revokedAt: null, replacedByTokenId: null, user: { status: 'ACTIVE' },
    });
    await expect(service.refresh('algum-valor', fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh succeeds for a valid, unused, unexpired token and rotates it', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1', userId: 'u1', expiresAt: new Date(Date.now() + 10_000), revokedAt: null, replacedByTokenId: null,
      user: { id: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['DASHBOARD'], status: 'ACTIVE' },
    });
    prisma.refreshToken.create.mockResolvedValue({ id: 'rt2' });
    const result = await service.refresh('algum-valor', fakeRes);
    expect(result.accessToken).toBe('signed.jwt.token');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({ where: { id: 'rt1' }, data: { replacedByTokenId: 'rt2' } });
  });

  it('register rejects a duplicate email with a clean 409 instead of an unhandled 500', async () => {
    // Id no formato cuid-like (minúsculo alfanumérico, 20-30 chars, sem hífen) — assertValidSchemaName
    // (Task 1) rejeitaria "company-1" (hífen + curto demais) antes mesmo do CREATE SCHEMA rodar,
    // mascarando o P2002 real que este teste quer provar.
    prisma.company.create.mockResolvedValue({ id: 'companyduplicado123456789', name: 'Empresa Duplicada' });
    prisma.profile.create.mockResolvedValue({ id: 'profile-duplicado' });
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      }),
    );
    await expect(
      service.register({ ...baseRegisterDto, email: 'ja-existe@test.com' }, fakeRes),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates an "Administrador Geral" profile with every catalog permission and assigns it to the founder', async () => {
    // Id no formato cuid-like (minúsculo alfanumérico, sem hífen) — assertValidSchemaName (Task 1)
    // rejeitaria "company-1" (hífen) antes mesmo de chegar em tx.profile.create, mascarando o que
    // este teste quer provar (mesmo cuidado já documentado nos outros testes de register() deste
    // arquivo).
    const companyId = 'companyprofile123456789012';
    prisma.company.create.mockResolvedValue({ id: companyId, name: 'Empresa Teste', planTier: 'BASICO', maxEmployeeLogins: 10 });
    prisma.profile.create.mockResolvedValue({ id: 'profile-1' });
    prisma.user.create.mockResolvedValue({ id: 'user-1', companyId, email: 'a@b.com', role: 'ADMIN', modules: [], mustChangePassword: false, employeeId: null, hasFullPontoAccess: true, profileId: 'profile-1' });

    await service.register({ ...baseRegisterDto }, fakeRes);

    expect(prisma.profile.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId, name: 'Administrador Geral', isProtected: true }),
    }));
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ profileId: 'profile-1' }),
    }));
  });

  it('grants unconditionally every one of the 19 PERMISSION_CATALOG entries to the new profile, with scope EMPRESA (or null for scopeless permissions)', async () => {
    const companyId = 'companyprofile223456789012';
    prisma.company.create.mockResolvedValue({ id: companyId, name: 'Empresa Teste', planTier: 'BASICO', maxEmployeeLogins: 10 });
    prisma.profile.create.mockResolvedValue({ id: 'profile-1' });
    prisma.user.create.mockResolvedValue({ id: 'user-1', companyId, email: 'a@b.com', role: 'ADMIN', modules: [], mustChangePassword: false, employeeId: null, hasFullPontoAccess: true, profileId: 'profile-1' });

    await service.register({ ...baseRegisterDto }, fakeRes);

    const call = prisma.profile.create.mock.calls[0][0];
    const grants = call.data.permissions.create;
    expect(grants).toHaveLength(PERMISSION_CATALOG.length);
    for (const def of PERMISSION_CATALOG) {
      const grant = grants.find((g: any) => g.permissionCode === def.code);
      expect(grant).toBeDefined();
      expect(grant.companyId).toBe(companyId);
      expect(grant.scope).toBe(def.validScopes.length === 0 ? null : 'EMPRESA');
    }
  });

  describe('register — provisionamento de schema', () => {
    it('cria o schema físico e aplica todas as migrations de tenant dentro da mesma transação, antes de criar o usuário', async () => {
      // Id no formato cuid-like (minúsculo alfanumérico, sem hífen) — assertValidSchemaName
      // (Task 1) rejeitaria um valor com hífen antes de chegar no CREATE SCHEMA.
      const companyId = 'companyabc123456789012345';
      prisma.company.create.mockResolvedValue({ id: companyId });
      prisma.profile.create.mockResolvedValue({ id: 'profile-schema-test' });
      prisma.user.create.mockResolvedValue({
        id: 'user-1', companyId, email: 'a@b.com', role: 'ADMIN', modules: [],
        mustChangePassword: false, employeeId: null, hasFullPontoAccess: true,
      });

      await service.register({ ...baseRegisterDto }, fakeRes);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringMatching(/^CREATE SCHEMA "padaria_central_[a-z0-9]{8}"$/),
      );
      const callOrder = prisma.$executeRawUnsafe.mock.invocationCallOrder;
      const userCreateOrder = prisma.user.create.mock.invocationCallOrder[0];
      expect(Math.max(...callOrder)).toBeLessThan(userCreateOrder);

      // Achado da revisão do Task 7: a asserção acima só provava a ordem CREATE SCHEMA -> user.create,
      // nunca que o pg_advisory_xact_lock (o fix real pro deadlock 40P01 documentado em
      // AuthService.register) sequer é chamado, nem que ele roda ANTES de company.create() — a
      // única coisa que impede a corrida (dois INSERTs concorrentes em Company + as dezenas de
      // ALTER TABLE ... REFERENCES "Company" das migrations) é essa trava rodar primeiro. Sem esta
      // asserção, um refactor futuro podia remover/reordenar o lock silenciosamente e só o e2e
      // (dependente de timing, não garantido em toda execução) acabaria pegando a regressão.
      const lockCallIndex = prisma.$executeRaw.mock.calls.findIndex(
        (args: unknown[]) => Array.isArray(args[0]) && (args[0] as string[]).join('').includes('pg_advisory_xact_lock'),
      );
      expect(lockCallIndex).not.toBe(-1);
      const lockCallOrder = prisma.$executeRaw.mock.invocationCallOrder[lockCallIndex];
      const companyCreateOrder = prisma.company.create.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(companyCreateOrder);
    });
  });

  describe('register — dados cadastrais', () => {
    beforeEach(() => {
      prisma.company.create.mockImplementation(async ({ data }: any) => ({ id: 'companyreg1234567890123456', planTier: 'BASICO', maxEmployeeLogins: 10, ...data }));
      prisma.profile.create.mockResolvedValue({ id: 'p1' });
      prisma.user.create.mockImplementation(async ({ data }: any) => ({ id: 'u1', employeeId: null, mustChangePassword: false, hasFullPontoAccess: true, ...data }));
    });

    it('grava documento normalizado, endereço, nome de exibição = fantasia e schemaName legível', async () => {
      await service.register({ ...baseRegisterDto }, fakeRes);
      const data = prisma.company.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        name: 'Padaria Central',
        personType: 'PJ',
        document: '11222333000181',
        legalName: 'Padaria Central Comércio de Alimentos Ltda',
        tradeName: 'Padaria Central',
        phone: '11987654321',
        zipCode: '01310100',
        state: 'SP',
      });
      expect(data.id).toMatch(/^c[a-z0-9]{24}$/);
      expect(data.schemaName).toBe(`padaria_central_${data.id.slice(-8)}`);
      expect(prisma.user.create.mock.calls[0][0].data.name).toBe('Carlos Eduardo');
    });

    // Planos grátis e pagos (26/09/2026): toda empresa nova nasce no plano GRATIS, nunca mais no
    // antigo default BASICO — ver PLAN_CATALOG em plan-catalog.ts.
    it('grava planTier GRATIS pra toda empresa nova', async () => {
      await service.register({ ...baseRegisterDto }, fakeRes);
      const data = prisma.company.create.mock.calls[0][0].data;
      expect(data.planTier).toBe('GRATIS');
    });

    // Fix pós-revisão (26/09/2026): grava também o teto de logins do catálogo (GRATIS = 2) na
    // criação da empresa — coluna legada (Company.maxEmployeeLogins), mantida só por consistência,
    // já que nenhuma leitura de negócio depende mais dela (ver plan-limits.util.ts).
    it('grava maxEmployeeLogins do catálogo (GRATIS = 2) na criação da empresa', async () => {
      await service.register({ ...baseRegisterDto }, fakeRes);
      const data = prisma.company.create.mock.calls[0][0].data;
      expect(data.maxEmployeeLogins).toBe(2);
    });

    // Fix pós-revisão (26/09/2026): a Aba Assinatura do frontend usava maxEmployeeLogins direto da
    // coluna legada (default de schema 10), mostrando capacidade errada pra uma empresa GRATIS (teto
    // real 2, ver PLAN_CATALOG). toPublicUser precisa derivar do catálogo por planTier, nunca da
    // coluna crua — os 3 testes abaixo forçam a linha mockada a carregar um valor de coluna
    // DIFERENTE do valor correto do catálogo, pra provar que a derivação (não a coluna) decide.
    it('devolve maxEmployeeLogins do catálogo (2) mesmo que a linha da empresa carregue 10 na coluna legada', async () => {
      // `data` NÃO é espalhado aqui de propósito: a linha retornada precisa carregar
      // maxEmployeeLogins: 10 (coluna legada, valor DIFERENTE do catálogo, 2) mesmo que o fix de
      // "gravar o teto do catálogo em create()" tenha gravado 2 — só assim este teste prova que
      // toPublicUser deriva de planTier, não da coluna crua da linha retornada.
      prisma.company.create.mockImplementationOnce(async () => ({
        id: 'companygratis123456789012', name: 'Padaria Central', planTier: 'GRATIS', maxEmployeeLogins: 10,
        personType: 'PJ', document: null, legalName: 'x', tradeName: null,
      }));
      const result = await service.register({ ...baseRegisterDto }, fakeRes);
      expect(result.user.maxEmployeeLogins).toBe(2);
    });

    it('devolve maxEmployeeLogins do catálogo (50) pra uma empresa PRO', async () => {
      prisma.company.create.mockImplementationOnce(async () => ({
        id: 'companypro123456789012345', name: 'Padaria Central', planTier: 'PRO', maxEmployeeLogins: 10,
        personType: 'PJ', document: null, legalName: 'x', tradeName: null,
      }));
      const result = await service.register({ ...baseRegisterDto }, fakeRes);
      expect(result.user.maxEmployeeLogins).toBe(50);
    });

    it('devolve maxEmployeeLogins null (ilimitado) pra uma empresa EMPRESARIAL', async () => {
      prisma.company.create.mockImplementationOnce(async () => ({
        id: 'companyemp123456789012345', name: 'Padaria Central', planTier: 'EMPRESARIAL', maxEmployeeLogins: 10,
        personType: 'PJ', document: null, legalName: 'x', tradeName: null,
      }));
      const result = await service.register({ ...baseRegisterDto }, fakeRes);
      expect(result.user.maxEmployeeLogins).toBeNull();
    });

    // Task 4 (26/09/2026): user.plan é o mesmo formato usado pela aba Assinatura/telas de upgrade —
    // toda empresa nova nasce GRATIS (ver teste acima), então o `user` de register() precisa expor
    // o plano Grátis completo, incluindo os módulos/recursos bloqueados com o plano mínimo que libera.
    it('devolve user.plan com o plano Grátis completo (módulos, features vazias e itens bloqueados)', async () => {
      const result = await service.register({ ...baseRegisterDto }, fakeRes);
      expect(result.user.plan).toEqual({
        tier: 'GRATIS',
        label: 'Grátis',
        modules: ['DASHBOARD', 'CLIENTES', 'RH_CARGOS', 'RH_FUNCIONARIOS'],
        features: [],
        locked: expect.objectContaining({ PONTO_REGISTRO: { tier: 'BASICO', label: 'Básico' } }),
      });
    });

    it('PF sem fantasia usa o nome completo como nome de exibição e fonte do schema', async () => {
      await service.register(
        { ...baseRegisterDto, personType: 'PF', document: '529.982.247-25', legalName: 'Ana Souza', tradeName: undefined },
        fakeRes,
      );
      const data = prisma.company.create.mock.calls[0][0].data;
      expect(data.name).toBe('Ana Souza');
      expect(data.tradeName).toBeNull();
      expect(data.schemaName).toBe(`ana_souza_${data.id.slice(-8)}`);
    });

    it('devolve documento mascarado e nome do usuário na resposta pública', async () => {
      const result = await service.register({ ...baseRegisterDto }, fakeRes);
      expect(result.user).toMatchObject({
        name: 'Carlos Eduardo',
        personType: 'PJ',
        documentMasked: '11.222.***/0001-**',
        legalName: 'Padaria Central Comércio de Alimentos Ltda',
        tradeName: 'Padaria Central',
        companyName: 'Padaria Central',
      });
      expect(JSON.stringify(result.user)).not.toContain('11222333000181');
    });

    it('CNPJ inválido é recusado antes de abrir a transação', async () => {
      await expect(service.register({ ...baseRegisterDto, document: '11.222.333/0001-82' }, fakeRes)).rejects.toThrow('CNPJ inválido');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // Pré-checagem barata ANTES do lock global de provisionamento: um e-mail/documento já
    // cadastrado nunca chega a pegar pg_advisory_xact_lock('tenant_provisioning') nem montar schema.
    it('e-mail já cadastrado é recusado antes de abrir a transação', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });
      await expect(service.register({ ...baseRegisterDto }, fakeRes)).rejects.toThrow(
        new ConflictException('Este e-mail já está cadastrado'),
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: baseRegisterDto.email } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('documento já cadastrado é recusado antes de abrir a transação (CNPJ normalizado)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.company.findUnique.mockResolvedValueOnce({ id: 'existing-company' });
      await expect(service.register({ ...baseRegisterDto }, fakeRes)).rejects.toThrow(
        new ConflictException('Já existe uma conta com este CNPJ'),
      );
      expect(prisma.company.findUnique).toHaveBeenCalledWith({ where: { document: '11222333000181' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('CPF já cadastrado é recusado antes de abrir a transação, falando CPF', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.company.findUnique.mockResolvedValueOnce({ id: 'existing-company' });
      await expect(
        service.register({ ...baseRegisterDto, personType: 'PF', document: '529.982.247-25', tradeName: undefined }, fakeRes),
      ).rejects.toThrow('Já existe uma conta com este CPF');
      expect(prisma.company.findUnique).toHaveBeenCalledWith({ where: { document: '52998224725' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      [['email'], 'Este e-mail já está cadastrado'],
      [['document'], 'Já existe uma conta com este CNPJ'],
    ])('P2002 em %j vira 409 com mensagem própria', async (target, message) => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target } }),
      );
      await expect(service.register({ ...baseRegisterDto }, fakeRes)).rejects.toThrow(new ConflictException(message));
    });

    it('P2002 de documento em PF fala CPF', async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['document'] } }),
      );
      await expect(
        service.register({ ...baseRegisterDto, personType: 'PF', document: '529.982.247-25', tradeName: undefined }, fakeRes),
      ).rejects.toThrow('Já existe uma conta com este CPF');
    });

    // Achado no e2e real (Task 6, Postgres de verdade): pra ALGUMAS violações de unique constraint
    // do User.email, o Prisma devolve err.meta SEM `target` — o fast path acima (que só olha
    // meta.target) nunca reconhece esse caso e relança o erro cru como 500. Desambiguação por
    // lookup fora da transação já desfeita (runAsSystem, mesmo padrão de login()).
    describe('P2002 sem meta.target (Prisma às vezes omite o alvo da constraint)', () => {
      it('e-mail já existe: consulta User por e-mail e mapeia pra 409 de e-mail', async () => {
        prisma.$transaction.mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: {} }),
        );
        // 1ª consulta = pré-checagem (livre: a corrida acontece depois dela); 2ª = desambiguação.
        prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing-user' });
        await expect(service.register({ ...baseRegisterDto }, fakeRes)).rejects.toThrow('Este e-mail já está cadastrado');
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: baseRegisterDto.email } });
      });

      it('e-mail livre mas documento já existe: consulta Company por documento e mapeia pra 409 de CNPJ', async () => {
        prisma.$transaction.mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: {} }),
        );
        prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        prisma.company.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing-company' });
        await expect(service.register({ ...baseRegisterDto }, fakeRes)).rejects.toThrow('Já existe uma conta com este CNPJ');
        expect(prisma.$transaction).toHaveBeenCalled();
        expect(prisma.company.findUnique).toHaveBeenCalledWith({ where: { document: '11222333000181' } });
      });

      it('nem e-mail nem documento existem: relança o erro original em vez de inventar uma causa', async () => {
        const original = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: {} });
        prisma.$transaction.mockRejectedValueOnce(original);
        prisma.user.findUnique.mockResolvedValueOnce(null);
        prisma.company.findUnique.mockResolvedValueOnce(null);
        await expect(service.register({ ...baseRegisterDto }, fakeRes)).rejects.toBe(original);
      });
    });
  });

  it('changePassword rejects an incorrect current password', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: '1', passwordHash: 'h' });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    await expect(service.changePassword('1', { currentPassword: 'errada', newPassword: 'nova12345' })).rejects.toThrow('Senha atual incorreta');
  });

  it('changePassword revokes every active refresh token, clears mustChangePassword, and returns a fresh access token', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: 'u1', companyId: 'c1', role: 'ADMIN', modules: ['DASHBOARD'], passwordHash: 'h', mustChangePassword: true,
    });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    const result = await service.changePassword('u1', { currentPassword: 'antiga12345', newPassword: 'nova12345' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: expect.any(String), mustChangePassword: false },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    // O access token ANTIGO (ainda em memória no frontend até este ponto)
    // continuaria carregando mustChangePassword: true por até 15min — sem
    // devolver um token novo aqui, JwtAuthGuard bloquearia o resto da sessão
    // logo após uma troca de senha bem-sucedida (ver esse guard).
    expect(result.accessToken).toBe('signed.jwt.token');
  });

  describe('linkCurrentUserToEmployee', () => {
    // Achado 1 da revisão final (27/09/2026): sem esta trava, um login de alcance restrito escolhia a
    // própria raiz de alcance (vinculando-se a um gerente, por exemplo).
    it('recusa com 403 PERMISSION_REQUIRED, antes de qualquer leitura, quando o login tem alcance restrito sem usuarios.gerenciar', async () => {
      authorization.getEffectivePermissions.mockResolvedValue({ 'funcionarios.ver': 'EQUIPE', 'ponto.registrar': null });
      const err = await service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2').catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual({
        statusCode: 403,
        code: 'PERMISSION_REQUIRED',
        message:
          'Seu acesso está ligado aos seus próprios dados, mas seu login ainda não tem uma ficha de funcionário. Peça a quem administra os acessos para vincular.',
      });
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('permite alcance restrito quando o login também tem usuarios.gerenciar', async () => {
      authorization.getEffectivePermissions.mockResolvedValue({ 'funcionarios.ver': 'EQUIPE', 'usuarios.gerenciar': null });
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-2', companyId: 'company-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow
        .mockResolvedValueOnce({ id: 'user-1', employeeId: null })
        .mockResolvedValueOnce({ id: 'user-1', email: 'a@b.com', role: 'ADMIN', modules: [], mustChangePassword: false, employeeId: 'employee-2' });
      const profile = await service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2');
      expect(profile.employeeId).toBe('employee-2');
      expect(profile.canSelfLinkEmployee).toBe(true);
    });

    it('o usuário público expõe canSelfLinkEmployee calculado das permissões', async () => {
      authorization.getEffectivePermissions.mockResolvedValue({ 'funcionarios.ver': 'PROPRIO' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', email: 'a@b.com', role: 'EMPLOYEE', modules: [], mustChangePassword: false, employeeId: null });
      const profile = await service.getProfile('user-1');
      expect(profile.canSelfLinkEmployee).toBe(false);
    });

    it('rejects when the target employee does not exist in the caller company', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-other-company'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the target employee already has a different login linked', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-someone-else', employeeId: 'employee-1' });
      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // Mesma regra da rota administrativa (PATCH /companies/me/users/:id/employee): só ficha ativa.
    it('rejects when the target employee is inactive, without linking', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-2', companyId: 'company-1', status: 'INACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', employeeId: null });

      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2'),
      ).rejects.toThrow('Funcionário inativo não pode ser vinculado a um login');
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    // Um User que JÁ tem employeeId vinculado não pode trocar de vínculo por esta rota.
    it('rejects when the calling login already has an employeeId linked (no swapping via this route)', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-2', companyId: 'company-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null); // employee-2 has no login yet
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', employeeId: 'employee-already-linked' });

      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('links the calling login to the target employee and returns the updated profile', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-2', companyId: 'company-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null); // no existing login for employee-2
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow
        .mockResolvedValueOnce({ id: 'user-1', employeeId: null }) // caller, not yet linked
        .mockResolvedValueOnce({
          id: 'user-1', email: 'admin@empresa.com', role: 'ADMIN', modules: ['DASHBOARD'],
          mustChangePassword: false, employeeId: 'employee-2',
        }); // getProfile() after the update

      const profile = await service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2');

      expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'user-1', employeeId: null }, data: { employeeId: 'employee-2' } });
      expect(profile.employeeId).toBe('employee-2');
    });

    it('maps a lost race on employeeId (P2002) to a clean 409 instead of an unhandled 500', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-2', companyId: 'company-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null); // pre-check passes, then loses the real race
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', employeeId: null });
      prisma.user.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`employeeId`)', {
          code: 'P2002',
          clientVersion: '5.22.0',
          meta: { target: ['employeeId'] },
        }),
      );

      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2'),
      ).rejects.toThrow('Este funcionário já está vinculado a outro login');
    });
  });

  describe('edição da própria conta (Minha conta)', () => {
    const profileRow = {
      id: 'u1', email: 'a@b.com', role: 'ADMIN', modules: [], mustChangePassword: false, employeeId: null,
      hasFullPontoAccess: true, name: 'Nome Novo',
      company: {
        name: 'Loja Nova', planTier: 'BASICO', maxEmployeeLogins: 10, personType: 'PJ', document: '11222333000181',
        legalName: 'Razao Nova Ltda', tradeName: 'Loja Nova', phone: '11987654321', zipCode: '01310100',
        street: 'Avenida Paulista', number: '1000', complement: null, district: 'Bela Vista', city: 'São Paulo', state: 'SP',
      },
    };

    beforeEach(() => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(profileRow);
      prisma.user.update.mockResolvedValue({});
      prisma.company.update.mockResolvedValue({});
    });

    it('updateMe grava só o nome do próprio usuário e devolve o perfil atualizado', async () => {
      const result = await service.updateMe('u1', { name: 'Nome Novo' });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { name: 'Nome Novo' } });
      expect(result).toMatchObject({ name: 'Nome Novo', companyName: 'Loja Nova' });
    });

    const companyDto = {
      legalName: 'Razao Nova Ltda', tradeName: 'Loja Nova', phone: '(11) 98765-4321', zipCode: '01310-100',
      street: 'Avenida Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP',
    };

    it('updateCompany normaliza telefone/CEP, usa a fantasia como nome de exibição e devolve o perfil com endereço', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ personType: 'PJ' });
      const result = await service.updateCompany('u1', 'c1', { ...companyDto });
      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: {
          name: 'Loja Nova', legalName: 'Razao Nova Ltda', tradeName: 'Loja Nova', phone: '11987654321',
          zipCode: '01310100', street: 'Avenida Paulista', number: '1000', complement: null,
          district: 'Bela Vista', city: 'São Paulo', state: 'SP',
        },
      });
      expect(result).toMatchObject({
        companyPhone: '11987654321',
        companyAddress: { zipCode: '01310100', street: 'Avenida Paulista', number: '1000', complement: null, district: 'Bela Vista', city: 'São Paulo', state: 'SP' },
      });
    });

    it('updateCompany nunca altera documento, tipo de pessoa nem schemaName', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ personType: 'PJ' });
      await service.updateCompany('u1', 'c1', { ...companyDto });
      const data = prisma.company.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('document');
      expect(data).not.toHaveProperty('personType');
      expect(data).not.toHaveProperty('schemaName');
    });

    it('PJ sem nome fantasia é recusado', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ personType: 'PJ' });
      await expect(service.updateCompany('u1', 'c1', { ...companyDto, tradeName: '' })).rejects.toThrow(BadRequestException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('PF sem nome fantasia usa o nome completo como nome de exibição', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ personType: 'PF' });
      await service.updateCompany('u1', 'c1', { ...companyDto, legalName: 'Ana Souza', tradeName: undefined });
      expect(prisma.company.update.mock.calls[0][0].data).toMatchObject({ name: 'Ana Souza', tradeName: null });
    });

    it('telefone inválido é recusado', async () => {
      prisma.company.findUniqueOrThrow.mockResolvedValue({ personType: 'PJ' });
      await expect(service.updateCompany('u1', 'c1', { ...companyDto, phone: '123' })).rejects.toThrow(BadRequestException);
    });
  });

  // Task 5 ("Acesso e sessões", 26/09/2026): esqueci minha senha / redefinir senha.
  describe('forgotPassword', () => {
    it('e-mail inexistente devolve a mensagem genérica sem chamar issue nem send', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('fantasma@teste.com');

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('usuário ACTIVE recebe o e-mail de redefinição de senha e a mesma mensagem genérica', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', company: { name: 'Padaria Central' },
      });
      userTokens.issue.mockResolvedValue('raw-reset-token');

      const result = await service.forgotPassword('ana@teste.com');
      await flush();

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(userTokens.issue).toHaveBeenCalledWith('u1', 'PASSWORD_RESET');
      expect(email.send).toHaveBeenCalledTimes(1);
      const [message, context] = email.send.mock.calls[0];
      expect(message.to).toBe('ana@teste.com');
      expect(message.subject).toMatch(/redefinição de senha/i);
      expect(message.html).toContain('/redefinir-senha');
      expect(message.html).toContain('raw-reset-token');
      expect(context).toBe('password-reset');
    });

    it('usuário INVITED reenvia o convite (nunca um e-mail de redefinição) com a mesma mensagem genérica', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u2', email: 'convidado@teste.com', status: 'INVITED', company: { name: 'Padaria Central' },
      });
      userTokens.issue.mockResolvedValue('raw-invite-token');

      const result = await service.forgotPassword('convidado@teste.com');
      await flush();

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(userTokens.issue).toHaveBeenCalledWith('u2', 'INVITE');
      expect(email.send).toHaveBeenCalledTimes(1);
      const [message, context] = email.send.mock.calls[0];
      expect(message.to).toBe('convidado@teste.com');
      expect(message.subject).toMatch(/convidado/i);
      expect(message.html).toContain('/aceitar-convite');
      expect(message.html).toContain('raw-invite-token');
      expect(context).toBe('invite');
    });

    it('ACTIVE com link de redefinição emitido há menos de 5min → mesma resposta, sem emitir nem enviar', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', company: null });
      userTokens.hasRecentPending.mockResolvedValue(true);

      const result = await service.forgotPassword('ana@teste.com');
      await flush();

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(userTokens.hasRecentPending).toHaveBeenCalledWith('u1', 'PASSWORD_RESET', 5 * 60_000);
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('INVITED com convite emitido há menos de 5min → mesma resposta, sem reemitir nem reenviar o convite', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u2', email: 'convidado@teste.com', status: 'INVITED', company: { name: 'Padaria Central' },
      });
      userTokens.hasRecentPending.mockResolvedValue(true);

      const result = await service.forgotPassword('convidado@teste.com');
      await flush();

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      expect(userTokens.hasRecentPending).toHaveBeenCalledWith('u2', 'INVITE', 5 * 60_000);
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('fora da janela de 5min (nenhum link recente pendente) → emite e envia normalmente', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', company: null });
      userTokens.hasRecentPending.mockResolvedValue(false);

      await service.forgotPassword('ana@teste.com');
      await flush();

      expect(userTokens.hasRecentPending).toHaveBeenCalledWith('u1', 'PASSWORD_RESET', 5 * 60_000);
      expect(userTokens.issue).toHaveBeenCalledWith('u1', 'PASSWORD_RESET');
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('com conta, responde sem esperar a checagem de cooldown (anti-enumeração por latência)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', company: null });
      userTokens.hasRecentPending.mockImplementation(never);

      await expect(settlesQuickly(service.forgotPassword('ana@teste.com'))).resolves.toBe('settled');
    });

    it('falha ao emitir/enviar o e-mail nunca troca a mensagem genérica por um erro', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', company: null });
      userTokens.issue.mockRejectedValue(new Error('db down'));
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const result = await service.forgotPassword('ana@teste.com');
      await flush();

      expect(result).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      // Pego e logado por userId/contexto (nunca uma unhandled rejection, nunca o token).
      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).toContain('u1');
      expect(logError.mock.calls[0][0]).toContain('password-reset');
      logError.mockRestore();
    });

    it('envio rejeitado também é pego e logado', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', company: null });
      email.send.mockRejectedValue(new Error('smtp down'));
      const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.forgotPassword('ana@teste.com')).resolves.toEqual({ message: FORGOT_PASSWORD_MESSAGE });
      await flush();

      expect(logError).toHaveBeenCalledTimes(1);
      expect(logError.mock.calls[0][0]).not.toContain('raw-reset-token');
      logError.mockRestore();
    });

    // Anti-enumeração por latência (review da Task 5): com conta, a resposta não pode esperar
    // issue()/send() — senão demora mais que a de um e-mail inexistente e revela a conta.
    it('com conta, responde sem esperar o envio: send que nunca termina não segura a resposta', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', company: null });
      email.send.mockImplementation(never);

      await expect(settlesQuickly(service.forgotPassword('ana@teste.com'))).resolves.toBe('settled');
      await flush();
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('com conta, responde sem esperar a emissão do token: issue que nunca termina não segura a resposta', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u2', email: 'c@teste.com', status: 'INVITED', company: { name: 'X' } });
      userTokens.issue.mockImplementation(never);

      await expect(settlesQuickly(service.forgotPassword('c@teste.com'))).resolves.toBe('settled');
    });
  });

  describe('sendInviteEmail', () => {
    it('emite um token INVITE, envia o e-mail e devolve a url do convite + se foi enviado', async () => {
      userTokens.issue.mockResolvedValue('raw-invite-token');
      email.send.mockResolvedValue(true);

      const result = await service.sendInviteEmail('u3', 'novo@teste.com', 'Padaria Central');

      expect(userTokens.issue).toHaveBeenCalledWith('u3', 'INVITE');
      expect(result.inviteUrl).toContain('/aceitar-convite');
      expect(result.inviteUrl).toContain('raw-invite-token');
      expect(result.sent).toBe(true);
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'novo@teste.com' }), 'invite');
    });
  });

  // Task 7 ("Acesso e sessões"): aceite de convite — define a senha, ativa e confirma o e-mail.
  describe('acceptInvite', () => {
    const invitedUser = { id: 'u5', email: 'novo@teste.com', status: 'INVITED' };

    it('token válido de usuário INVITED define a senha, ativa o login e confirma o e-mail', async () => {
      userTokens.consume.mockResolvedValue('u5');
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...invitedUser });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.acceptInvite('token-valido', 'senhaNova12345');

      expect(userTokens.consume).toHaveBeenCalledWith('token-valido', 'INVITE');
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        // status: 'INVITED' no where: aceite atômico — um block() concorrente nunca é desfeito.
        where: { id: 'u5', status: 'INVITED' },
        data: expect.objectContaining({
          passwordHash: expect.any(String),
          status: 'ACTIVE',
          emailVerifiedAt: expect.any(Date),
          failedLoginAttempts: 0,
          lockedUntil: null,
          mustChangePassword: false,
        }),
      });
      const data = prisma.user.updateMany.mock.calls[0][0].data;
      expect(data.passwordHash).not.toBe('senhaNova12345');
    });

    it.each(['BLOCKED', 'ACTIVE', 'LOCKED'])('usuário %s é recusado com o 400 genérico, sem alterar nada', async (status) => {
      userTokens.consume.mockResolvedValue('u5');
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...invitedUser, status });

      await expect(service.acceptInvite('token-valido', 'senhaNova12345')).rejects.toThrow(
        new BadRequestException('Link inválido ou expirado. Peça um novo.'),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('corrida: bloqueado entre a leitura e a escrita (updateMany count 0) → mesmo 400', async () => {
      userTokens.consume.mockResolvedValue('u5');
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...invitedUser });
      prisma.user.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.acceptInvite('token-valido', 'senhaNova12345')).rejects.toThrow(
        'Link inválido ou expirado. Peça um novo.',
      );
    });

    it('token inválido/expirado repassa a BadRequestException de consume()', async () => {
      userTokens.consume.mockRejectedValue(new BadRequestException('Link inválido ou expirado. Peça um novo.'));

      await expect(service.acceptInvite('token-invalido', 'senhaNova12345')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const activeUser = {
      id: 'u1', email: 'ana@teste.com', status: 'ACTIVE', passwordHash: 'antigo', emailVerifiedAt: null,
    };

    it('token válido troca a senha, zera o bloqueio, confirma o e-mail e revoga as sessões — sem e-mail de aviso', async () => {
      userTokens.consume.mockResolvedValue('u1');
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...activeUser });

      await service.resetPassword('token-valido', 'senhaNova12345');

      expect(userTokens.consume).toHaveBeenCalledWith('token-valido', 'PASSWORD_RESET');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          passwordHash: expect.any(String),
          failedLoginAttempts: 0,
          lockedUntil: null,
          mustChangePassword: false,
          emailVerifiedAt: expect.any(Date),
        },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      // A pessoa acabou de usar o link da própria caixa de entrada — um "senha alterada" seria um
      // e-mail pago sem informação nova.
      expect(email.send).not.toHaveBeenCalled();
    });

    it('mantém emailVerifiedAt já existente em vez de sobrescrever com a data de agora', async () => {
      const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
      userTokens.consume.mockResolvedValue('u1');
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...activeUser, emailVerifiedAt: verifiedAt });

      await service.resetPassword('token-valido', 'senhaNova12345');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({ emailVerifiedAt: verifiedAt }),
      });
    });

    it('usuário BLOCKED tem a senha trocada mas status nunca entra no data (BLOCKED nunca é desfeito por reset)', async () => {
      userTokens.consume.mockResolvedValue('u1');
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...activeUser, status: 'BLOCKED' });

      await service.resetPassword('token-valido', 'senhaNova12345');

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('status');
    });

    it('usuário INVITED é recusado — convite se aceita pela rota de convite, nunca por redefinir senha', async () => {
      userTokens.consume.mockResolvedValue('u2');
      prisma.user.findUniqueOrThrow.mockResolvedValue({ ...activeUser, id: 'u2', status: 'INVITED' });

      await expect(service.resetPassword('token-valido', 'senhaNova12345')).rejects.toThrow(
        'Link inválido ou expirado. Peça um novo.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('token inválido/expirado repassa a BadRequestException de consume()', async () => {
      userTokens.consume.mockRejectedValue(new BadRequestException('Link inválido ou expirado. Peça um novo.'));

      await expect(service.resetPassword('token-invalido', 'senhaNova12345')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
  // Task 6 ("Acesso e sessões", 26/09/2026): confirmação de e-mail de quem cria a empresa.
  describe('confirmação de e-mail', () => {
    describe('register', () => {
      beforeEach(() => {
        prisma.company.create.mockImplementation(async ({ data }: any) => ({ id: 'companyreg1234567890123456', ...data }));
        prisma.profile.create.mockResolvedValue({ id: 'p1' });
        prisma.user.create.mockImplementation(async ({ data }: any) => ({
          id: 'u1', employeeId: null, mustChangePassword: false, hasFullPontoAccess: true, emailVerifiedAt: null, ...data,
        }));
        userTokens.issue.mockResolvedValue('raw-verify-token');
      });

      it('cria o fundador com emailVerificationRequired: true e emailVerifiedAt: null', async () => {
        await service.register({ ...baseRegisterDto }, fakeRes);
        expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ emailVerificationRequired: true, emailVerifiedAt: null });
      });

      it('emite EMAIL_VERIFICATION e envia o link /confirmar-email?token= depois da transação', async () => {
        await service.register({ ...baseRegisterDto }, fakeRes);
        await flush();

        expect(userTokens.issue).toHaveBeenCalledWith('u1', 'EMAIL_VERIFICATION');
        expect(userTokens.issue.mock.invocationCallOrder[0]).toBeGreaterThan(prisma.user.create.mock.invocationCallOrder[0]);
        expect(email.send).toHaveBeenCalledTimes(1);
        const [message, context] = email.send.mock.calls[0];
        expect(message.to).toBe('a@b.com');
        expect(message.subject).toMatch(/confirme seu e-mail/i);
        expect(message.html).toContain('/confirmar-email?token=raw-verify-token');
        expect(context).toBe('email-verification');
      });

      it('falha ao emitir o token/enviar o e-mail não falha o cadastro (só loga)', async () => {
        userTokens.issue.mockRejectedValue(new Error('db down'));
        const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        const result = await service.register({ ...baseRegisterDto }, fakeRes);
        await flush();

        expect(result.accessToken).toBe('signed.jwt.token');
        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError.mock.calls[0][0]).not.toContain('raw-verify-token');
        logError.mockRestore();
      });

      it('o cadastro não espera o envio: send que nunca termina não segura a resposta', async () => {
        email.send.mockImplementation(never);
        await expect(settlesQuickly(service.register({ ...baseRegisterDto }, fakeRes))).resolves.toBe('settled');
      });

      it('nunca emite/envia nada se a transação de cadastro falhar', async () => {
        prisma.user.create.mockRejectedValue(new Error('boom'));
        await expect(service.register({ ...baseRegisterDto }, fakeRes)).rejects.toThrow('boom');
        await flush();
        expect(userTokens.issue).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
      });

      it('devolve emailVerified: false / emailVerificationRequired: true e assina emailVerificationPending: true', async () => {
        const result = await service.register({ ...baseRegisterDto }, fakeRes);
        expect(result.user.emailVerified).toBe(false);
        expect(result.user.emailVerificationRequired).toBe(true);
        expect(jwtService.sign).toHaveBeenCalledWith(
          expect.objectContaining({ emailVerificationPending: true }),
          expect.anything(),
        );
      });
    });

    it('login de um usuário confirmado assina emailVerificationPending: false e expõe emailVerified: true', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1', companyId: 'c1', role: 'ADMIN', modules: [], status: 'ACTIVE', passwordHash: 'h',
        mustChangePassword: false, hasFullPontoAccess: true, failedLoginAttempts: 0, lockedUntil: null,
        emailVerificationRequired: true, emailVerifiedAt: new Date(),
      });
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      const result = await service.login({ email: 'x@x.com', password: 'y' }, fakeRes);

      expect(result.user.emailVerified).toBe(true);
      expect(result.user.emailVerificationRequired).toBe(true);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerificationPending: false }),
        expect.anything(),
      );
    });

    it('login não-confirmado mas sem exigência (legado/convidado) nunca fica pendente', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1', companyId: 'c1', role: 'EMPLOYEE', modules: [], status: 'ACTIVE', passwordHash: 'h',
        mustChangePassword: false, hasFullPontoAccess: true, failedLoginAttempts: 0, lockedUntil: null,
        emailVerificationRequired: false, emailVerifiedAt: null,
      });
      jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt1' });

      await service.login({ email: 'x@x.com', password: 'y' }, fakeRes);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerificationPending: false }),
        expect.anything(),
      );
    });

    it('refresh relê o usuário e assina o estado ATUAL da confirmação', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1', userId: 'u1', expiresAt: new Date(Date.now() + 10_000), revokedAt: null, replacedByTokenId: null,
        user: {
          id: 'u1', companyId: 'c1', role: 'ADMIN', modules: [], status: 'ACTIVE', hasFullPontoAccess: true,
          emailVerificationRequired: true, emailVerifiedAt: null,
        },
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt2' });

      await service.refresh('algum-valor', fakeRes);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ emailVerificationPending: true }),
        expect.anything(),
      );
    });

    it('getProfile expõe emailVerified/emailVerificationRequired', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        id: 'u1', email: 'a@b.com', companyId: 'c1', role: 'ADMIN', modules: [], mustChangePassword: false,
        employeeId: null, hasFullPontoAccess: true, emailVerificationRequired: true, emailVerifiedAt: null,
      });

      const profile = await service.getProfile('u1');

      expect(profile.emailVerified).toBe(false);
      expect(profile.emailVerificationRequired).toBe(true);
    });

    describe('verifyEmail', () => {
      it('consome o token EMAIL_VERIFICATION e grava emailVerifiedAt', async () => {
        userTokens.consume.mockResolvedValue('u1');

        await service.verifyEmail('token-valido');

        expect(userTokens.consume).toHaveBeenCalledWith('token-valido', 'EMAIL_VERIFICATION');
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { emailVerifiedAt: expect.any(Date) } });
      });

      it('token inválido/expirado repassa a BadRequestException de consume() sem gravar nada', async () => {
        userTokens.consume.mockRejectedValue(new BadRequestException('Link inválido ou expirado. Peça um novo.'));

        await expect(service.verifyEmail('token-invalido')).rejects.toThrow('Link inválido ou expirado. Peça um novo.');
        expect(prisma.user.update).not.toHaveBeenCalled();
      });
    });

    describe('resendVerification', () => {
      it('já confirmado → 400 "Seu e-mail já está confirmado." sem emitir nada', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'Ana', emailVerifiedAt: new Date() });

        await expect(service.resendVerification('u1')).rejects.toThrow(new BadRequestException('Seu e-mail já está confirmado.'));
        expect(userTokens.issue).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
      });

      // Q3: login que não precisa confirmar (convidado que aceitou, legado) → mesmo 400, sem emitir.
      it('emailVerificationRequired false → 400 "Seu e-mail já está confirmado." sem emitir nada', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          id: 'u1', email: 'a@b.com', name: 'Ana', emailVerifiedAt: null, emailVerificationRequired: false,
        });

        await expect(service.resendVerification('u1')).rejects.toThrow(new BadRequestException('Seu e-mail já está confirmado.'));
        expect(userTokens.issue).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
      });

      it('link de confirmação emitido há menos de 5min → { sent: false } sem reemitir nem reenviar', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          id: 'u1', email: 'a@b.com', name: 'Ana', emailVerifiedAt: null, emailVerificationRequired: true,
        });
        userTokens.hasRecentPending.mockResolvedValue(true);

        await expect(service.resendVerification('u1')).resolves.toEqual({ sent: false });
        expect(userTokens.hasRecentPending).toHaveBeenCalledWith('u1', 'EMAIL_VERIFICATION', 5 * 60_000);
        expect(userTokens.issue).not.toHaveBeenCalled();
        expect(email.send).not.toHaveBeenCalled();
      });

      it('fora da janela de 5min → reemite e devolve { sent: true } quando o provedor aceita', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          id: 'u1', email: 'a@b.com', name: 'Ana', emailVerifiedAt: null, emailVerificationRequired: true,
        });
        email.send.mockResolvedValue(true);

        await expect(service.resendVerification('u1')).resolves.toEqual({ sent: true });
        expect(userTokens.hasRecentPending).toHaveBeenCalledWith('u1', 'EMAIL_VERIFICATION', 5 * 60_000);
        expect(userTokens.issue).toHaveBeenCalledWith('u1', 'EMAIL_VERIFICATION');
      });

      it('pendente → reemite EMAIL_VERIFICATION, reenvia e devolve { sent }', async () => {
        prisma.user.findUniqueOrThrow.mockResolvedValue({
          id: 'u1', email: 'a@b.com', name: 'Ana', emailVerifiedAt: null, emailVerificationRequired: true,
        });
        userTokens.issue.mockResolvedValue('raw-verify-token-2');
        email.send.mockResolvedValue(false);

        const result = await service.resendVerification('u1');

        expect(result).toEqual({ sent: false });
        expect(userTokens.issue).toHaveBeenCalledWith('u1', 'EMAIL_VERIFICATION');
        const [message, context] = email.send.mock.calls[0];
        expect(message.to).toBe('a@b.com');
        expect(message.html).toContain('/confirmar-email?token=raw-verify-token-2');
        expect(context).toBe('email-verification');
      });
    });
  });
});
