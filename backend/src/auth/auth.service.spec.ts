import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import * as passwordUtil from './password.util';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;
  const fakeRes = { cookie: jest.fn(), clearCookie: jest.fn() } as any;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn(), create: jest.fn() },
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
      tenantMigration: { create: jest.fn().mockResolvedValue({}) },
      company: { create: jest.fn() },
      employee: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: prisma }, { provide: JwtService, useValue: { sign: jest.fn(() => 'signed.jwt.token') } }],
    }).compile();
    service = module.get(AuthService);
    jwtService = module.get(JwtService);
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

  it('login rejects a locked (excesso de tentativas) user with its own specific 403 message', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'LOCKED', passwordHash: 'h', failedLoginAttempts: 5 });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);
    await expect(service.login({ email: 'x@x.com', password: 'y' }, fakeRes)).rejects.toThrow(/redefinir sua senha/i);
  });

  it('login rejects an incorrect password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE', passwordHash: 'h', failedLoginAttempts: 0 });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    await expect(service.login({ email: 'x@x.com', password: 'errada' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Achado durante a auditoria de segurança (17/09/2026): o rate-limit por janela de tempo
  // (ThrottlerGuard) nunca acaba de verdade — dá pra esperar e tentar de novo. Este contador é
  // persistente (só reseta com login certo ou ação de admin).
  it('login increments the persistent failed-attempt counter on a wrong password, without locking before the 5th', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE', passwordHash: 'h', failedLoginAttempts: 2 });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    await expect(service.login({ email: 'x@x.com', password: 'errada' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: '1' }, data: { failedLoginAttempts: 3 } });
  });

  it('login locks the account (status LOCKED) on reaching the 5th consecutive wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE', passwordHash: 'h', failedLoginAttempts: 4 });
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(false);
    // Mesma mensagem genérica, mesmo sendo a tentativa que travou a conta — nunca revela o estado.
    await expect(service.login({ email: 'x@x.com', password: 'errada' }, fakeRes)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: '1' },
      data: { failedLoginAttempts: 5, status: 'LOCKED' },
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

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { failedLoginAttempts: 0 } });
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
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      }),
    );
    await expect(
      service.register({ companyName: 'Empresa Duplicada', email: 'ja-existe@test.com', password: 'senha12345' }, fakeRes),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('register — provisionamento de schema', () => {
    it('cria o schema físico e aplica todas as migrations de tenant dentro da mesma transação, antes de criar o usuário', async () => {
      // Id no formato cuid-like (minúsculo alfanumérico, sem hífen) — assertValidSchemaName
      // (Task 1) rejeitaria um valor com hífen antes de chegar no CREATE SCHEMA.
      const companyId = 'companyabc123456789012345';
      prisma.company.create.mockResolvedValue({ id: companyId });
      prisma.user.create.mockResolvedValue({
        id: 'user-1', companyId, email: 'a@b.com', role: 'ADMIN', modules: [],
        mustChangePassword: false, employeeId: null, hasFullPontoAccess: true,
      });

      await service.register({ companyName: 'Acme', email: 'a@b.com', password: 'senha123456' }, fakeRes);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(`CREATE SCHEMA "tenant_${companyId}"`),
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
    it('rejects when the target employee does not exist in the caller company', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-other-company'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the target employee already has a different login linked', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', companyId: 'company-1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-someone-else', employeeId: 'employee-1' });
      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // Este é o caso central do Passo 4 do brief: um User que JÁ tem
    // employeeId vinculado não pode trocar de vínculo por esta rota.
    it('rejects when the calling login already has an employeeId linked (no swapping via this route)', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-2', companyId: 'company-1' });
      prisma.user.findUnique.mockResolvedValue(null); // employee-2 has no login yet
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1', employeeId: 'employee-already-linked' });

      await expect(
        service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('links the calling login to the target employee and returns the updated profile', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-2', companyId: 'company-1' });
      prisma.user.findUnique.mockResolvedValue(null); // no existing login for employee-2
      prisma.user.findUniqueOrThrow
        .mockResolvedValueOnce({ id: 'user-1', employeeId: null }) // caller, not yet linked
        .mockResolvedValueOnce({
          id: 'user-1', email: 'admin@empresa.com', role: 'ADMIN', modules: ['DASHBOARD'],
          mustChangePassword: false, employeeId: 'employee-2',
        }); // getProfile() after the update

      const profile = await service.linkCurrentUserToEmployee('user-1', 'company-1', 'employee-2');

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { employeeId: 'employee-2' } });
      expect(profile.employeeId).toBe('employee-2');
    });
  });
});
