import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import * as profileAssignmentUtil from '../permissions/profile-assignment.util';
import * as lastPermissionHolderUtil from './last-permission-holder.util';
import { TimeManagementAuthService } from '../time-management/time-management-auth.service';
import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UserTokensService } from '../auth/user-tokens/user-tokens.service';
import { InviteMailer } from '../auth/user-tokens/invite-mailer';
import { EmailService } from '../email/email.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PERMISSION_CATALOG } from '../permissions/permission-catalog';

// Chamador padrão dos testes: um ADMIN que JÁ tem acesso total ao Ponto — o caso que passa
// livremente pelos gates de acesso total ao Ponto. Testes que exercitam um gate em si passam
// `makeCaller({ hasFullPontoAccess: false })` ou `role: 'EMPLOYEE'`.
function makeCaller(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    userId: 'caller-1',
    companyId: 'company-1',
    role: 'ADMIN',
    modules: [],
    mustChangePassword: false,
    hasFullPontoAccess: true,
    permissions: {},
    ...overrides,
  };
}

// `assertHasFullPontoAccess` real (não um jest.fn() vazio): o gate só protege de verdade se o teste
// exercitar a MESMA regra que o backend aplica (404 pra quem não é ADMIN de acesso total).
function makeTimeAuth() {
  return new TimeManagementAuthService({} as any);
}

// Concessão limitada (28/09/2026): o poder do chamador vem do banco (getEffectivePermissions) e os
// grants ATUAIS de um perfil de getProfileGrants. Padrão: chamador com o catálogo inteiro no alcance
// máximo (como o Administrador Geral), então passa por toda checagem de poder — a intenção dos
// testes existentes não muda. `profileGrants` mapeia profileId → grants atuais (padrão: nenhum).
function fullCallerGrants(): Record<string, string | null> {
  return Object.fromEntries(
    PERMISSION_CATALOG.map((p) => [p.code, p.validScopes.includes('EMPRESA') ? 'EMPRESA' : null]),
  );
}

function makeAuthz(
  callerGrants: Record<string, string | null> = fullCallerGrants(),
  profileGrants: Record<string, { permissionCode: string; scope: string | null }[]> = {},
) {
  return {
    getEffectivePermissions: jest.fn().mockResolvedValue(callerGrants),
    getProfileGrants: jest.fn((_companyId: string, profileId: string | null) =>
      Promise.resolve(profileId ? (profileGrants[profileId] ?? []) : []),
    ),
  } as any;
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let inviteMailer: { sendInvite: jest.Mock };
  let userTokens: { issue: jest.Mock; consume: jest.Mock };
  let email: { send: jest.Mock };
  let authz: ReturnType<typeof makeAuthz>;

  beforeEach(async () => {
    inviteMailer = {
      sendInvite: jest.fn().mockResolvedValue({ inviteUrl: 'http://localhost:5173/aceitar-convite?token=raw-invite', sent: true }),
    };
    userTokens = { issue: jest.fn().mockResolvedValue('raw-reset-token'), consume: jest.fn() };
    email = { send: jest.fn().mockResolvedValue(true) };
    authz = makeAuthz();
    prisma = {
      employee: { findFirst: jest.fn(), findMany: jest.fn() },
      user: {
        findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(),
        create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn(), delete: jest.fn(),
      },
      company: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      // Fase 2a (19/09/2026): create() não deriva/cria mais um Profile — o admin escolhe um
      // profileId já existente na tela, e o service só valida que ele pertence à empresa
      // (`profile.findFirst({ where: { id, companyId } })`). Por padrão, qualquer id "existe".
      profile: {
        findFirst: jest.fn().mockResolvedValue({ id: 'profile-1', companyId: 'c1' }),
      },
      // Grants do profileId escolhido — create() lê isso pra DERIVAR `modules`/`hasFullPontoAccess`
      // (direção oposta da assinatura antiga). Default: só dashboard.ver, suficiente pros testes que
      // não afirmam nada sobre modules/hasFullPontoAccess.
      profilePermission: {
        findMany: jest.fn().mockResolvedValue([{ permissionCode: 'dashboard.ver', scope: null }]),
      },
      // Suporta os dois estilos de $transaction usados neste service: array (block(), via
      // runTenantTransaction) e callback (updatePontoAccess() desligando acesso, via
      // runTenantInteractiveTransaction) — mesmo padrão já usado em auth.service.spec.ts. Sem
      // contexto de tenant ativo (ALS) nestes testes, as duas funções helper delegam direto pra
      // este mock, então `tx` dentro do callback é o próprio objeto `prisma` do teste.
      $transaction: jest.fn((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
      // Chamado por runTenantInteractiveTransaction antes do callback (set_config da RLS) e pelo
      // pg_advisory_xact_lock em updatePontoAccess — não é exercitado por nenhuma asserção própria
      // na maioria dos testes, só precisa existir pra `tx.$executeRaw` não quebrar como
      // `undefined()`.
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      // Chamado por assertNotLastHolderOfPermission — a PRIMEIRA chamada é sempre a consulta de
      // existência ("o alvo detém a permissão?"). O default abaixo (`exists: false`) é o caso
      // seguro/no-op para block/remove, permitindo que testes genéricos passem sem mockagem
      // adicional; os testes específicos da trava sobrescrevem as duas chamadas em sequência.
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ exists: false }]),
    };
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        // Injetado desde a revisão final da branch (Fase 2a, 22/09/2026) — assignProfile() usa
        // `assertHasFullPontoAccess` pra restaurar o gate que morreu junto com
        // `PATCH .../ponto-access`. Só esse método do serviço é usado aqui.
        { provide: TimeManagementAuthService, useValue: { assertHasFullPontoAccess: jest.fn() } },
        { provide: InviteMailer, useValue: inviteMailer },
        { provide: UserTokensService, useValue: userTokens },
        { provide: EmailService, useValue: email },
        { provide: AuthorizationService, useValue: authz },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  // Achados 1 e 4 da revisão final (27/09/2026): quem gerencia usuários vincula o login de outra
  // pessoa a uma ficha de funcionário e escolhe entre funcionários ativos ainda sem login.
  describe('linkEmployee (PATCH /companies/me/users/:id/employee)', () => {
    it('404 quando o login alvo é de outra empresa', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.linkEmployee('company-1', 'user-other', 'employee-1', makeCaller())).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ id: 'user-other', companyId: 'company-1' });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('400 quando o login alvo já tem ficha vinculada', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: 'EMPLOYEE', hasFullPontoAccess: true, employeeId: 'e-old' });
      await expect(service.linkEmployee('company-1', 'u2', 'employee-1', makeCaller())).rejects.toThrow('Este login já está vinculado a um funcionário');
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('400 quando o funcionário não existe nesta empresa', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: 'ADMIN', hasFullPontoAccess: true, employeeId: null });
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.linkEmployee('company-1', 'u2', 'employee-x', makeCaller())).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('400 quando o funcionário está inativo', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: 'ADMIN', hasFullPontoAccess: true, employeeId: null });
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', status: 'INACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.linkEmployee('company-1', 'u2', 'employee-1', makeCaller())).rejects.toThrow('Funcionário inativo não pode ser vinculado a um login');
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('400 quando o funcionário já tem outro login', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: 'ADMIN', hasFullPontoAccess: true, employeeId: null });
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue({ id: 'u3' });
      await expect(service.linkEmployee('company-1', 'u2', 'employee-1', makeCaller())).rejects.toThrow('Este funcionário já possui um login vinculado');
    });

    it('409 amigável quando perde a corrida (P2002)', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: 'ADMIN', hasFullPontoAccess: true, employeeId: null });
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['employeeId'] } }),
      );
      await expect(service.linkEmployee('company-1', 'u2', 'employee-1', makeCaller())).rejects.toBeInstanceOf(ConflictException);
    });

    it('vincula, devolve o login no formato da listagem e não encerra sessões', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', role: 'EMPLOYEE', hasFullPontoAccess: true, employeeId: null });
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1', status: 'ACTIVE' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u2', role: 'EMPLOYEE', hasFullPontoAccess: true, employeeId: 'employee-1' });
      const result = await service.linkEmployee('company-1', 'u2', 'employee-1', makeCaller());
      expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u2', employeeId: null }, data: { employeeId: 'employee-1' } });
      const call = prisma.user.findUniqueOrThrow.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'u2' });
      expect(call.select.passwordHash).toBeUndefined();
      expect(call.select.employeeId).toBe(true);
      expect(result).toEqual({ id: 'u2', role: 'EMPLOYEE', hasFullPontoAccess: false, employeeId: 'employee-1' });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listLinkableEmployees (GET /companies/me/users/linkable-employees)', () => {
    it('lista funcionários ativos sem login, por nome, lendo User (central) e Employee (tenant) em consultas separadas', async () => {
      prisma.user.findMany.mockResolvedValue([{ employeeId: 'e1' }, { employeeId: 'e2' }]);
      prisma.employee.findMany.mockResolvedValue([{ id: 'e3', fullName: 'Ana' }]);
      const result = await service.listLinkableEmployees('company-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', employeeId: { not: null } },
        select: { employeeId: true },
      });
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', status: 'ACTIVE', id: { notIn: ['e1', 'e2'] } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: 'e3', fullName: 'Ana' }]);
    });
  });

  it('findAllForCompany never selects passwordHash', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.findAllForCompany('c1');
    const call = prisma.user.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ companyId: 'c1' });
    expect(call.select).toBeDefined();
    expect(call.select.passwordHash).toBeUndefined();
  });

  // Achado C2 da revisão final (15/09/2026): a coluna nasce `true` pra toda linha, EMPLOYEE
  // inclusive — a listagem tem que mostrar o valor EFETIVO, nunca o cru, pra Usuários e Acessos
  // não anunciar "Acesso total ao Ponto" pra um login que o backend nega em toda mutação.
  it('findAllForCompany presents the EFFECTIVE hasFullPontoAccess (false for EMPLOYEE rows, whatever the column says)', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', role: 'ADMIN', hasFullPontoAccess: true },
      { id: 'u2', role: 'ADMIN', hasFullPontoAccess: false },
      { id: 'u3', role: 'EMPLOYEE', hasFullPontoAccess: true },
    ]);

    const users = await service.findAllForCompany('c1');

    expect(users.map((u: any) => [u.id, u.hasFullPontoAccess])).toEqual([
      ['u1', true],
      ['u2', false],
      ['u3', false],
    ]);
  });

  it('create returns the EFFECTIVE hasFullPontoAccess for a newly created EMPLOYEE login', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'c1', planTier: 'BASICO' });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.create.mockResolvedValue({ id: 'u9', role: 'EMPLOYEE', hasFullPontoAccess: true });

    const { user } = await service.create('c1', { email: 'f@a.com', role: 'EMPLOYEE', employeeId: 'emp-1', profileId: 'profile-1' } as any, makeCaller());

    expect(user.hasFullPontoAccess).toBe(false);
  });

  it('create never selects passwordHash back for the created user', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin3@a.com', role: 'ADMIN' });
    await service.create('c1', { email: 'admin3@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());
    const call = prisma.user.create.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.passwordHash).toBeUndefined();
  });

  // Fase 2a (19/09/2026): create() não deriva/cria mais um Profile — o profileId vem pronto do DTO
  // (escolhido pelo admin na tela) e é usado tal como está, sem nenhuma lógica de assinatura/
  // desambiguação por nome (isso agora só existe no backfill legado).
  it('create usa o profileId do DTO diretamente, sem derivar/reaproveitar um perfil por assinatura', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin2@a.com', role: 'ADMIN' });
    await service.create('c1', { email: 'admin2@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());

    expect(prisma.profile.findFirst).toHaveBeenCalledWith({ where: { id: 'profile-1', companyId: 'c1' } });
    expect(prisma.user.create.mock.calls[0][0].data.profileId).toBe('profile-1');
  });

  it('rejeita profileId que não pertence à empresa', async () => {
    prisma.profile.findFirst.mockResolvedValue(null);
    await expect(
      service.create('c1', { email: 'x@a.com', role: 'ADMIN', profileId: 'profile-de-outra-empresa' } as any, makeCaller()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('c1', { email: 'x@a.com', role: 'ADMIN', profileId: 'profile-de-outra-empresa' } as any, makeCaller()),
    ).rejects.toThrow('profile-de-outra-empresa');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // Direção OPOSTA da assinatura antiga: `modules`/`hasFullPontoAccess` agora são DERIVADOS dos
  // grants do profileId escolhido, via deriveModulesFromGrants/deriveHasFullPontoAccessFromGrants
  // (Task 1), lidos de tx.profilePermission.findMany({ where: { profileId } }).
  it('deriva modules e hasFullPontoAccess a partir dos grants do profileId escolhido', async () => {
    prisma.profilePermission.findMany.mockResolvedValue([
      { permissionCode: 'dashboard.ver', scope: null },
      { permissionCode: 'ponto.administrar', scope: 'EMPRESA' },
    ]);
    prisma.user.create.mockResolvedValue({ id: 'u5', email: 'admin5@a.com', role: 'ADMIN' });

    await service.create('c1', { email: 'admin5@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());

    expect(prisma.profilePermission.findMany).toHaveBeenCalledWith({ where: { profileId: 'profile-1' } });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.modules).toEqual(['DASHBOARD', 'PONTO_ADMINISTRACAO']);
    expect(data.hasFullPontoAccess).toBe(true);
  });

  it('rejects creating an EMPLOYEE login without employeeId', async () => {
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', profileId: 'profile-1' } as any, makeCaller()))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login for an employee from another company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, makeCaller()))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating a second login for an employee that already has one', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, makeCaller()))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login once the plan limit is reached', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'BASICO' });
    prisma.user.count.mockResolvedValue(10);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, makeCaller()))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  // Planos grátis e pagos (26/09/2026): o limite de logins de funcionário agora vem do catálogo
  // (plan-catalog.ts), não mais de Company.maxEmployeeLogins lido cru — GRATIS tem teto 2.
  it('rejects creating an EMPLOYEE login once the GRATIS plan limit (2) is reached, with the catalog message', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
    prisma.user.count.mockResolvedValue(2);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, makeCaller()))
      .rejects.toThrow('Limite do plano Grátis: até 2 logins de funcionário ativos. Faça upgrade para cadastrar mais.');
  });

  // Task 7 ("Acesso e sessões", 26/09/2026): convite por e-mail em vez de senha temporária fixa.
  it('creates an EMPLOYEE login as INVITED with an unusable random password hash and sends the invite', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'BASICO', name: 'Padaria Central' });
    prisma.user.count.mockResolvedValue(9);
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@a.com', role: 'EMPLOYEE' });

    const result: any = await service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, makeCaller());

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.status).toBe('INVITED');
    expect(data.mustChangePassword).toBe(false);
    expect(data.emailVerifiedAt).toBeNull();
    expect(typeof data.passwordHash).toBe('string');
    expect(data.passwordHash.length).toBeGreaterThan(0);
    expect(data.passwordHash).not.toBe('Mudar@123');
    expect(inviteMailer.sendInvite).toHaveBeenCalledWith('u1', 'a@a.com', 'Padaria Central');
    expect(result.inviteUrl).toBe('http://localhost:5173/aceitar-convite?token=raw-invite');
    expect(result.sent).toBe(true);
    expect(result).not.toHaveProperty('temporaryPassword');
    expect(result.user.id).toBe('u1');
  });

  it('never reuses the same password hash between two created logins (random value, not a fixed password)', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ name: 'X' });
    prisma.user.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'u9', email: data.email, role: data.role }));
    await service.create('c1', { email: 'admin9@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());
    await service.create('c1', { email: 'admin8@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());
    const [h1, h2] = prisma.user.create.mock.calls.map((c: any) => c[0].data.passwordHash);
    expect(h1).not.toBe(h2);
    expect(prisma.user.create.mock.calls[0][0].data.status).toBe('INVITED');
  });

  it('counts ACTIVE + INVITED EMPLOYEE logins against the plan limit on create', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS', name: 'X' });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@a.com', role: 'EMPLOYEE' });
    await service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, makeCaller());
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { companyId: 'c1', role: 'EMPLOYEE', status: { in: ['ACTIVE', 'INVITED'] } },
    });
  });

  it('still returns the created login (sent: false, inviteUrl: null) when the invite cannot even be prepared', async () => {
    prisma.company.findUniqueOrThrow.mockResolvedValue({ name: 'X' });
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'x@a.com', role: 'ADMIN' });
    inviteMailer.sendInvite.mockRejectedValue(new Error('db down'));
    const result: any = await service.create('c1', { email: 'x@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());
    expect(result.user.id).toBe('u2');
    expect(result).toMatchObject({ inviteUrl: null, sent: false });
  });

  it('rejects creating a login with an e-mail already used by ANY company with a clean 409 instead of an unhandled 500', async () => {
    // User.email é único GLOBALMENTE, não por empresa — mesmo padrão/mesmo
    // bug já corrigido em AuthService.register() (ver auth.service.spec.ts).
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      }),
    );
    await expect(
      service.create('c1', { email: 'ja-existe-em-outra-empresa@test.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a race on employeeId with the specific message, not the e-mail one, using err.meta.target', async () => {
    // O pre-check `existingLogin` já cobre o caso comum — este teste cobre a corrida real (duas
    // requisições passam o pre-check antes de qualquer uma escrever), disambiguada por
    // err.meta.target em vez de assumir sempre que um P2002 aqui é sobre e-mail.
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'BASICO' });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`employeeId`)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['employeeId'] },
      }),
    );
    await expect(
      service.create('c1', { email: 'novo@test.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, makeCaller()),
    ).rejects.toThrow('Este funcionário já está vinculado a outro login');
  });

  it('creates an ADMIN login without checking the employee-linked plan limit', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin2@a.com', role: 'ADMIN' });
    const result = await service.create('c1', { email: 'admin2@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());
    expect(result.user.id).toBe('u2');
    // Única leitura de Company é o nome pro e-mail de convite — nunca o planTier do limite.
    expect(prisma.company.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(prisma.company.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'c1' }, select: { name: true } });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('block scopes the lookup to the current company and revokes active refresh tokens', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', role: 'EMPLOYEE', status: 'ACTIVE' });
    await service.block('c1', 'u1', makeCaller());
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('block 404s for a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.block('c1', 'u-outra-empresa', makeCaller())).rejects.toBeInstanceOf(NotFoundException);
  });

  // Achado durante a auditoria de segurança (17/09/2026) — mesmo invariante que updatePontoAccess já
  // protegia ("pelo menos um admin de acesso total"), agora estendido a "pelo menos um ADMIN ATIVO":
  // sem isso, bloquear o último admin ativo deixaria a empresa sem ninguém pra desbloquear ninguém.
  it('block rejects blocking the last ACTIVE ADMIN of the company', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
    prisma.user.count.mockResolvedValue(1);
    await expect(service.block('c1', 'admin1', makeCaller())).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('block allows blocking an ADMIN when at least one other ACTIVE ADMIN remains', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
    prisma.user.count.mockResolvedValue(2);
    await service.block('c1', 'admin1', makeCaller());
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'admin1' }, data: { status: 'BLOCKED' } });
  });

  // Task 8: Trava genérica de "último usuarios.gerenciar" — verifica que block() rejeita se o alvo
  // seria o último holder da permissão. Mock $queryRawUnsafe para retornar 0 (nenhum outro usuário
  // ativo da empresa tem a permissão após excluir esse).
  it('block rejects blocking the last holder of usuarios.gerenciar permission', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
    prisma.user.count.mockResolvedValue(2); // pelo menos 2 ADMINs ATIVOS (passa assertNotLastActiveAdmin)
    // 1ª chamada: o alvo DETÉM a permissão; 2ª: nenhum OUTRO login ativo detém.
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ count: 0n }]);
    await expect(service.block('c1', 'admin1', makeCaller())).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // Quem gerencia a assinatura (27/09/2026): bloquear o ÚNICO detentor de `assinatura.gerenciar`
  // é recusado, mesmo que ainda sobrem outros detentores de `usuarios.gerenciar`.
  it('block rejects blocking the last holder of assinatura.gerenciar', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
    prisma.user.count.mockResolvedValue(2);
    // usuarios.gerenciar: alvo detém, sobra outro detentor. assinatura.gerenciar: alvo detém, ninguém mais.
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ count: 1n }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ count: 0n }]);
    await expect(service.block('c1', 'admin1', makeCaller())).rejects.toThrow(/gerenciar a assinatura/);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.$queryRawUnsafe.mock.calls[3].slice(1)).toEqual(['c1', 'admin1', 'assinatura.gerenciar']);
  });

  it('unblock 404s for a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.unblock('c1', 'u-outra-empresa', makeCaller())).rejects.toBeInstanceOf(NotFoundException);
  });

  // Planos grátis e pagos (26/09/2026): reativar um login EMPLOYEE (block→unblock ou
  // LOCKED→unblock) também precisa respeitar o teto de logins do plano — sem isso, um admin
  // desbloqueava de volta um funcionário além do limite que create() já impediria pra um login novo.
  it('unblock rejects reactivating a LOCKED EMPLOYEE login once the GRATIS plan limit (2) is reached', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', role: 'EMPLOYEE', status: 'LOCKED' });
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
    prisma.user.count.mockResolvedValue(2);
    await expect(service.unblock('c1', 'u1', makeCaller())).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('unblock never checks the plan limit for an ADMIN login', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1', role: 'ADMIN', status: 'BLOCKED' });
    await service.unblock('c1', 'admin1', makeCaller());
    expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('unblock resets status to ACTIVE, zeroes the failed-login-attempts counter and clears lockedUntil', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', status: 'BLOCKED' });
    await service.unblock('c1', 'u1', makeCaller());
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('unblock counts ACTIVE + INVITED EMPLOYEE logins against the plan limit', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', role: 'EMPLOYEE', status: 'BLOCKED' });
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
    prisma.user.count.mockResolvedValue(0);
    await service.unblock('c1', 'u1', makeCaller());
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { companyId: 'c1', role: 'EMPLOYEE', status: { in: ['ACTIVE', 'INVITED'] } },
    });
  });

  // Fix round 1: um convite pendente bloqueado e depois desbloqueado volta a INVITED (não ACTIVE com
  // um hash aleatório inutilizável). Marcador de "nunca aceitou o convite": EMPLOYEE,
  // emailVerifiedAt null e emailVerificationRequired false.
  // Q4: o marcador é independente do papel — um ADMIN convidado que nunca aceitou também volta a
  // INVITED (fundadores têm emailVerificationRequired true e nunca caem aqui).
  it('unblock restores INVITED for a BLOCKED ADMIN that never accepted its invite', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'a2', companyId: 'c1', role: 'ADMIN', status: 'BLOCKED', emailVerifiedAt: null, emailVerificationRequired: false,
    });
    await service.unblock('c1', 'a2', makeCaller());
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'a2' },
      data: { status: 'INVITED', failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('unblock keeps a BLOCKED founder ADMIN (verification required, not yet verified) as ACTIVE', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'a1', companyId: 'c1', role: 'ADMIN', status: 'BLOCKED', emailVerifiedAt: null, emailVerificationRequired: true,
    });
    await service.unblock('c1', 'a1', makeCaller());
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('unblock restores INVITED (not ACTIVE) for a BLOCKED employee that never accepted its invite', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u1', companyId: 'c1', role: 'EMPLOYEE', status: 'BLOCKED', emailVerifiedAt: null, emailVerificationRequired: false,
    });
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'BASICO' });
    prisma.user.count.mockResolvedValue(0);
    await service.unblock('c1', 'u1', makeCaller());
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'INVITED', failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it.each([
    ['accepted invite (emailVerifiedAt set)', { role: 'EMPLOYEE', emailVerifiedAt: new Date(), emailVerificationRequired: false }],
    ['founder-style login (verification required)', { role: 'EMPLOYEE', emailVerifiedAt: null, emailVerificationRequired: true }],
    // Q4 (fix final): ADMIN com e-mail já confirmado volta a ACTIVE; ADMIN convidado que nunca aceitou
    // volta a INVITED (teste logo acima) — o marcador não depende mais do papel.
    ['ADMIN login (e-mail confirmado)', { role: 'ADMIN', emailVerifiedAt: new Date(), emailVerificationRequired: false }],
  ])('unblock restores ACTIVE for a BLOCKED %s', async (_label, fields) => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', status: 'BLOCKED', ...fields });
    prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'BASICO' });
    prisma.user.count.mockResolvedValue(0);
    await service.unblock('c1', 'u1', makeCaller());
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  // INVITED já conta no limite e ainda não tem senha — "desbloquear" só limpa a trava temporária,
  // nunca promove um convite pendente a ACTIVE (com um hash inutilizável e sem e-mail confirmado).
  it('unblock keeps an INVITED login INVITED (only clears the temporary lock) and skips the plan check', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', role: 'EMPLOYEE', status: 'INVITED' });
    await service.unblock('c1', 'u1', makeCaller());
    expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  describe('remove', () => {
    it('404s for a login from another company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.remove('c1', 'u-outra-empresa', makeCaller())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects deleting the last ACTIVE ADMIN of the company', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
      prisma.user.count.mockResolvedValue(1);
      await expect(service.remove('c1', 'admin1', makeCaller())).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('deletes a login for real (not a status change) when it is not the last active admin', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', role: 'EMPLOYEE', status: 'ACTIVE' });
      await service.remove('c1', 'u1', makeCaller());
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    });

    // Task 8: Trava genérica de "último usuarios.gerenciar" — verifica que remove() rejeita se o
    // alvo seria o último holder da permissão.
    it('remove rejects deleting the last holder of usuarios.gerenciar permission', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
      prisma.user.count.mockResolvedValue(2); // pelo menos 2 ADMINs ATIVOS (passa assertNotLastActiveAdmin)
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{ count: 0n }]);
      await expect(service.remove('c1', 'admin1', makeCaller())).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('remove rejects deleting the last holder of assinatura.gerenciar', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
      prisma.user.count.mockResolvedValue(2);
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ exists: false }])
        .mockResolvedValueOnce([{ exists: true }])
        .mockResolvedValueOnce([{ count: 0n }]);
      await expect(service.remove('c1', 'admin1', makeCaller())).rejects.toThrow(/gerenciar a assinatura/);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    // Regressão-alvo do achado C2: antes do fix, a contagem rodava INCONDICIONALMENTE — excluir um
    // login EMPLOYEE (que nunca detém `usuarios.gerenciar`) batia na trava sem motivo.
    it('remove permite excluir um login que NÃO detém usuarios.gerenciar, mesmo sem outros detentores', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'emp1', companyId: 'c1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'emp1', role: 'EMPLOYEE', status: 'ACTIVE' });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ exists: false }]);
      await service.remove('c1', 'emp1', makeCaller());
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'emp1' } });
    });
  });

  describe('resetPassword', () => {
    it('404s for a login from another company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resetPassword('c1', 'u-outra-empresa', makeCaller())).rejects.toBeInstanceOf(NotFoundException);
    });

    // Task 7 ("Acesso e sessões"): em vez de gerar 'Mudar@123', envia um link de redefinição pro
    // e-mail do login. Nada muda no login agora — a senha, o status e as sessões só mudam quando a
    // pessoa de fato redefine (AuthService.resetPassword).
    it('ACTIVE login: issues a PASSWORD_RESET token and e-mails the link, changing nothing on the login', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'ana@a.com', role: 'EMPLOYEE', status: 'ACTIVE' });

      const result: any = await service.resetPassword('c1', 'u1', makeCaller());

      expect(userTokens.issue).toHaveBeenCalledWith('u1', 'PASSWORD_RESET');
      expect(email.send).toHaveBeenCalledTimes(1);
      const [message, context] = email.send.mock.calls[0];
      expect(message.to).toBe('ana@a.com');
      expect(message.html).toContain('/redefinir-senha?token=raw-reset-token');
      expect(context).toBe('password-reset');
      expect(result).toEqual({ sent: true });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(inviteMailer.sendInvite).not.toHaveBeenCalled();
    });

    it('reports sent: false when the provider refuses', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'ana@a.com', role: 'ADMIN', status: 'ACTIVE' });
      email.send.mockResolvedValue(false);
      await expect(service.resetPassword('c1', 'u1', makeCaller())).resolves.toEqual({ sent: false });
    });

    it('INVITED login: re-sends the invite instead and returns { sent, inviteUrl }', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'ana@a.com', role: 'EMPLOYEE', status: 'INVITED' });
      prisma.company.findUniqueOrThrow.mockResolvedValue({ name: 'Padaria Central' });

      const result = await service.resetPassword('c1', 'u1', makeCaller());

      expect(inviteMailer.sendInvite).toHaveBeenCalledWith('u1', 'ana@a.com', 'Padaria Central');
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(result).toEqual({ sent: true, inviteUrl: 'http://localhost:5173/aceitar-convite?token=raw-invite' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    // Fix round 1: o reset não reativa nada (só manda um e-mail), então nunca checa o teto do plano —
    // nem pra um EMPLOYEE BLOCKED/LOCKED de uma empresa já no limite.
    it.each(['BLOCKED', 'LOCKED'])('sends the reset e-mail to a %s EMPLOYEE even at the GRATIS plan cap (no plan check)', async (status) => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'a@a.com', role: 'EMPLOYEE', status });
      prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'GRATIS' });
      prisma.user.count.mockResolvedValue(2);
      await expect(service.resetPassword('c1', 'u1', makeCaller())).resolves.toEqual({ sent: true });
      expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(userTokens.issue).toHaveBeenCalledWith('u1', 'PASSWORD_RESET');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not check the plan limit for an already-ACTIVE EMPLOYEE login', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'a@a.com', role: 'EMPLOYEE', status: 'ACTIVE' });
      await service.resetPassword('c1', 'u1', makeCaller());
      expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(email.send).toHaveBeenCalled();
    });

    it('never checks the plan limit for an ADMIN login', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1', email: 'a@a.com', role: 'ADMIN', status: 'BLOCKED' });
      await service.resetPassword('c1', 'admin1', makeCaller());
      expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(email.send).toHaveBeenCalled();
    });
  });

  describe('resendInvite', () => {
    it('404s for a login from another company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resendInvite('c1', 'u-outra-empresa', makeCaller())).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['ACTIVE', 'BLOCKED', 'LOCKED'])('rejects a %s login with "Este login já aceitou o convite."', async (status) => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'a@a.com', status });
      await expect(service.resendInvite('c1', 'u1', makeCaller())).rejects.toThrow(new BadRequestException('Este login já aceitou o convite.'));
      expect(inviteMailer.sendInvite).not.toHaveBeenCalled();
    });

    it('re-issues and re-sends the invite for an INVITED login, returning { inviteUrl, sent }', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'a@a.com', status: 'INVITED' });
      prisma.company.findUniqueOrThrow.mockResolvedValue({ name: 'Padaria Central' });
      const result = await service.resendInvite('c1', 'u1', makeCaller());
      expect(inviteMailer.sendInvite).toHaveBeenCalledWith('u1', 'a@a.com', 'Padaria Central');
      expect(result).toEqual({ inviteUrl: 'http://localhost:5173/aceitar-convite?token=raw-invite', sent: true });
    });
  });

  // Task 6, fix round 1: com Usuários liberado por `usuarios.gerenciar` (não mais pelo papel), um
  // login EMPLOYEE com a permissão podia reenviar o convite de um ADMIN ainda INVITED e receber o
  // `inviteUrl` cru na resposta, aceitando o convite ele mesmo e virando ADMIN. Recusado ANTES de
  // emitir token ou enviar e-mail.
  describe('reemissão de convite de ADMIN por quem não é ADMIN', () => {
    const BODY = {
      statusCode: 403,
      code: 'PERMISSION_REQUIRED',
      message: 'Só um administrador pode reenviar o convite de outro administrador.',
    };
    const nonAdmin = () => makeCaller({ role: 'EMPLOYEE', hasFullPontoAccess: false, permissions: { 'usuarios.gerenciar': null } });

    it('resendInvite: alvo ADMIN INVITED + chamador EMPLOYEE -> 403, sem token nem e-mail', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'a1', companyId: 'c1', email: 'adm@a.com', role: 'ADMIN', status: 'INVITED' });
      const err = await service.resendInvite('c1', 'a1', nonAdmin()).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual(BODY);
      expect(inviteMailer.sendInvite).not.toHaveBeenCalled();
      expect(userTokens.issue).not.toHaveBeenCalled();
    });

    it('resendInvite: alvo ADMIN INVITED + chamador ADMIN -> reenviado como hoje', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'a1', companyId: 'c1', email: 'adm@a.com', role: 'ADMIN', status: 'INVITED' });
      prisma.company.findUniqueOrThrow.mockResolvedValue({ name: 'Padaria Central' });
      const result = await service.resendInvite('c1', 'a1', makeCaller());
      expect(inviteMailer.sendInvite).toHaveBeenCalledWith('a1', 'adm@a.com', 'Padaria Central');
      expect(result.inviteUrl).toBe('http://localhost:5173/aceitar-convite?token=raw-invite');
    });

    it('resendInvite: alvo EMPLOYEE INVITED + chamador EMPLOYEE com a permissão -> reenviado', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', email: 'f@a.com', role: 'EMPLOYEE', status: 'INVITED' });
      prisma.company.findUniqueOrThrow.mockResolvedValue({ name: 'Padaria Central' });
      await service.resendInvite('c1', 'u1', nonAdmin());
      expect(inviteMailer.sendInvite).toHaveBeenCalled();
    });

    it('resetPassword: alvo ADMIN INVITED + chamador EMPLOYEE -> 403, sem token nem e-mail', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'a1', companyId: 'c1', email: 'adm@a.com', role: 'ADMIN', status: 'INVITED' });
      const err = await service.resetPassword('c1', 'a1', nonAdmin()).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual(BODY);
      expect(inviteMailer.sendInvite).not.toHaveBeenCalled();
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('resetPassword: alvo ADMIN INVITED + chamador ADMIN -> reenvia o convite como hoje', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'a1', companyId: 'c1', email: 'adm@a.com', role: 'ADMIN', status: 'INVITED' });
      prisma.company.findUniqueOrThrow.mockResolvedValue({ name: 'Padaria Central' });
      const result = await service.resetPassword('c1', 'a1', makeCaller());
      expect(inviteMailer.sendInvite).toHaveBeenCalled();
      expect(result.inviteUrl).toBe('http://localhost:5173/aceitar-convite?token=raw-invite');
    });

    // O link de redefinição de um ADMIN ACTIVE vai só pro e-mail do próprio ADMIN (nunca volta na
    // resposta), então não é uma via de tomada de conta: continua permitido.
    it('resetPassword: alvo ADMIN ACTIVE + chamador EMPLOYEE -> só envia o link pro e-mail do alvo, sem devolvê-lo', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'a1', companyId: 'c1', email: 'adm@a.com', role: 'ADMIN', status: 'ACTIVE' });
      const result = await service.resetPassword('c1', 'a1', nonAdmin());
      expect(result).toEqual({ sent: true });
      expect(email.send.mock.calls[0][0].to).toBe('adm@a.com');
    });

    // unblock() nunca emite token nem envia e-mail: só devolve um ADMIN que nunca aceitou o convite
    // pra INVITED; a reemissão em si passa por resendInvite/resetPassword, já barrados acima.
    it('unblock: devolve um ADMIN pra INVITED sem emitir token nem enviar e-mail', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'a1', companyId: 'c1', role: 'ADMIN', status: 'BLOCKED', emailVerifiedAt: null, emailVerificationRequired: false,
      });
      const result = await service.unblock('c1', 'a1', makeCaller());
      expect(result).toBeUndefined();
      expect(inviteMailer.sendInvite).not.toHaveBeenCalled();
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });
  });

  // Task 8 (Fase 2a, 19/09/2026): `assertNotLastHolderOfPermission` é espionado (não
  // auto-mockado no topo do arquivo) — os testes de block()/remove() acima dependem do
  // comportamento REAL dessa função (via `$queryRawUnsafe`), e um `jest.mock` de módulo inteiro
  // quebraria esses testes já existentes. `jest.spyOn` escopado a este describe (com
  // `mockRestore()` no `afterEach`) dá aos testes novos a asserção de chamada que precisam
  // (`toHaveBeenCalledWith`) sem afetar block()/remove().
  // Achado na 3ª rodada de re-revisão (22/09/2026): o QUARTO caminho pra mesma escalação, e o
  // único que MINTA um login novo em vez de mexer num existente. Um ADMIN restrito criava um Perfil
  // com `ponto.administrar@EMPRESA` (inofensivo sozinho) e então criava aqui um login ADMIN novo
  // apontando pra ele, já nascendo com `hasFullPontoAccess: true` — e como a senha temporária é
  // fixa ('Mudar@123'), bastava entrar na conta nova.
  describe('create — gate de acesso total ao Ponto', () => {
    const FULL_PONTO_GRANTS = [{ permissionCode: 'ponto.administrar', scope: 'EMPRESA' }];

    function makeService() {
      return new UsersService(prisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());
    }

    it('BARRA (404) um ADMIN restrito criando um login ADMIN novo com acesso total', async () => {
      prisma.profilePermission.findMany.mockResolvedValue(FULL_PONTO_GRANTS);
      const service2 = makeService();

      await expect(
        service2.create(
          'c1',
          { email: 'novo-admin@a.com', role: 'ADMIN', profileId: 'profile-1' } as any,
          makeCaller({ hasFullPontoAccess: false }),
        ),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    // Task 6 (permissões por ação e alcance): um chamador EMPLOYEE agora é barrado ANTES, pela regra
    // de escalação de papel (403 PERMISSION_REQUIRED) — nunca chega no gate de acesso total (404).
    it('BARRA (403) um chamador EMPLOYEE fazendo o mesmo, pela regra de escalação de papel', async () => {
      prisma.profilePermission.findMany.mockResolvedValue(FULL_PONTO_GRANTS);
      const service2 = makeService();

      await expect(
        service2.create(
          'c1',
          { email: 'novo-admin@a.com', role: 'ADMIN', profileId: 'profile-1' } as any,
          makeCaller({ role: 'EMPLOYEE' }),
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('PERMITE quando o chamador já tem acesso total', async () => {
      prisma.profilePermission.findMany.mockResolvedValue(FULL_PONTO_GRANTS);
      prisma.user.create.mockResolvedValue({ id: 'u-novo', role: 'ADMIN', hasFullPontoAccess: true });
      const service2 = makeService();

      const { user } = await service2.create(
        'c1',
        { email: 'novo-admin@a.com', role: 'ADMIN', profileId: 'profile-1' } as any,
        makeCaller(),
      );

      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.user.create.mock.calls[0][0].data.hasFullPontoAccess).toBe(true);
      expect(user.hasFullPontoAccess).toBe(true);
    });

    // Sem acesso total no perfil escolhido, o gate não tem o que proteger — um admin restrito
    // continua podendo criar logins normalmente.
    it('NÃO gateia a criação de um login ADMIN sem acesso total', async () => {
      prisma.profilePermission.findMany.mockResolvedValue([
        { permissionCode: 'ponto.administrar', scope: 'EQUIPE' },
      ]);
      prisma.user.create.mockResolvedValue({ id: 'u-novo', role: 'ADMIN', hasFullPontoAccess: false });
      const service2 = makeService();

      await service2.create(
        'c1',
        { email: 'novo-admin@a.com', role: 'ADMIN', profileId: 'profile-1' } as any,
        makeCaller({ hasFullPontoAccess: false }),
      );

      expect(prisma.user.create).toHaveBeenCalled();
    });

    // EMPLOYEE nunca tem acesso total por definição (effectiveHasFullPontoAccess), então mesmo um
    // perfil que conceda ponto.administrar@EMPRESA não é uma escalação aqui.
    it('NÃO gateia a criação de um login EMPLOYEE, mesmo com um perfil de acesso total', async () => {
      prisma.profilePermission.findMany.mockResolvedValue(FULL_PONTO_GRANTS);
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'c1', planTier: 'BASICO' });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({ id: 'u-novo', role: 'EMPLOYEE', hasFullPontoAccess: true });
      const service2 = makeService();

      const { user } = await service2.create(
        'c1',
        { email: 'novo-func@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any,
        makeCaller({ hasFullPontoAccess: false }),
      );

      expect(prisma.user.create).toHaveBeenCalled();
      expect(user.hasFullPontoAccess).toBe(false); // valor EFETIVO, sempre false pra EMPLOYEE
    });
  });

  // Task 6 (permissões por ação e alcance): Usuários passou a exigir `usuarios.gerenciar` em vez do
  // papel ADMIN — um login EMPLOYEE com essa permissão administra logins, mas nunca cria um login
  // ADMIN nem atribui o perfil protegido (Administrador Geral). Chamador ADMIN segue como antes.
  describe('escalação de papel por quem não é ADMIN', () => {
    const ESCALATION_BODY = {
      statusCode: 403,
      code: 'PERMISSION_REQUIRED',
      message: 'Só um administrador pode criar outro login de administrador.',
    };

    it('create: chamador EMPLOYEE com usuarios.gerenciar criando login ADMIN → 403 PERMISSION_REQUIRED, nada gravado', async () => {
      const caller = makeCaller({ role: 'EMPLOYEE', hasFullPontoAccess: false, permissions: { 'usuarios.gerenciar': null } });
      const err = await service
        .create('c1', { email: 'novo-admin@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, caller)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual(ESCALATION_BODY);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('create: chamador ADMIN criando login ADMIN continua permitido', async () => {
      prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin2@a.com', role: 'ADMIN', hasFullPontoAccess: false });
      const result = await service.create('c1', { email: 'admin2@a.com', role: 'ADMIN', profileId: 'profile-1' } as any, makeCaller());
      expect(result.user.id).toBe('u2');
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('create: chamador EMPLOYEE com usuarios.gerenciar criando login EMPLOYEE continua permitido', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'c1', planTier: 'BASICO', name: 'Empresa' });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue({ id: 'u3', role: 'EMPLOYEE', hasFullPontoAccess: true });
      const caller = makeCaller({ role: 'EMPLOYEE', hasFullPontoAccess: false, permissions: { 'usuarios.gerenciar': null } });
      await service.create('c1', { email: 'func@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-1' } as any, caller);
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('create: chamador EMPLOYEE atribuindo o perfil protegido (Administrador Geral) → 403 PERMISSION_REQUIRED', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'c1', planTier: 'BASICO' });
      prisma.user.count.mockResolvedValue(0);
      prisma.profile.findFirst.mockResolvedValue({ id: 'profile-admin', companyId: 'c1', name: 'Administrador Geral', isProtected: true });
      const caller = makeCaller({ role: 'EMPLOYEE', hasFullPontoAccess: false, permissions: { 'usuarios.gerenciar': null } });
      const err = await service
        .create('c1', { email: 'func@a.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'profile-admin' } as any, caller)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ statusCode: 403, code: 'PERMISSION_REQUIRED' });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('create: chamador ADMIN atribuindo o perfil protegido continua permitido', async () => {
      prisma.profile.findFirst.mockResolvedValue({ id: 'profile-admin', companyId: 'c1', name: 'Administrador Geral', isProtected: true });
      prisma.user.create.mockResolvedValue({ id: 'u4', role: 'ADMIN', hasFullPontoAccess: false });
      await service.create('c1', { email: 'admin3@a.com', role: 'ADMIN', profileId: 'profile-admin' } as any, makeCaller());
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('assignProfile: chamador EMPLOYEE atribuindo o perfil protegido → 403 PERMISSION_REQUIRED, sem transação', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1', profileId: 'p-old', role: 'EMPLOYEE' });
      prisma.profile.findFirst.mockResolvedValue({ id: 'profile-admin', companyId: 'c1', name: 'Administrador Geral', isProtected: true });
      const caller = makeCaller({ role: 'EMPLOYEE', hasFullPontoAccess: false, permissions: { 'usuarios.gerenciar': null } });
      const err = await service.assignProfile('c1', 'u1', 'profile-admin', caller).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ statusCode: 403, code: 'PERMISSION_REQUIRED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('assignProfile', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    function makeTxPrisma(currentProfileId: string | null, role: 'ADMIN' | 'EMPLOYEE' = 'EMPLOYEE') {
      const tx = {
        $executeRaw: jest.fn(),
        // Releitura do alvo DENTRO da trava (revisão final da branch, 22/09/2026) — fecha a corrida
        // de duas reatribuições concorrentes do mesmo usuário baseando a checagem num profileId já
        // desatualizado.
        user: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 'u1', companyId: 'company-1', profileId: currentProfileId, role }),
        },
        profilePermission: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const txPrisma = {
        user: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'u1', companyId: 'company-1', profileId: currentProfileId, role }),
        },
        profile: { findFirst: jest.fn().mockResolvedValue({ id: 'new-profile', companyId: 'company-1' }) },
        $transaction: jest.fn((cb: any) => cb(tx)),
      };
      return { prisma: txPrisma, tx };
    }

    // ORDEM IMPORTA: o service lê `newGrants` PRIMEIRO (fora do `if (profileId)`) e só depois
    // `currentGrants` — inverter estes dois mocks faz os testes afirmarem o contrário do código.
    function mockGrants(tx: any, newGrants: unknown[], currentGrants: unknown[]) {
      (tx.profilePermission.findMany as jest.Mock)
        .mockResolvedValueOnce(newGrants)
        .mockResolvedValueOnce(currentGrants);
    }

    it('lança NotFoundException se o login não existir na empresa', async () => {
      const localPrisma = { user: { findFirst: jest.fn().mockResolvedValue(null) }, profile: { findFirst: jest.fn() } };
      const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

      await expect(localService.assignProfile('company-1', 'missing', 'p2', makeCaller())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lança BadRequestException se o novo profileId não existir na empresa', async () => {
      const localPrisma = {
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', companyId: 'company-1', profileId: 'p1' }) },
        profile: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

      await expect(localService.assignProfile('company-1', 'u1', 'missing', makeCaller())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('não chama a trava se o usuário nunca teve perfil (profileId null)', async () => {
      const assertNotLastHolderOfPermissionSpy = jest
        .spyOn(lastPermissionHolderUtil, 'assertNotLastHolderOfPermission')
        .mockResolvedValue(undefined);
      const reassignUserProfileSpy = jest
        .spyOn(profileAssignmentUtil, 'reassignUserProfile')
        .mockResolvedValue(undefined);
      const { prisma: localPrisma, tx } = makeTxPrisma(null);
      const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

      await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

      expect(assertNotLastHolderOfPermissionSpy).not.toHaveBeenCalled();
      expect(reassignUserProfileSpy).toHaveBeenCalledWith(tx, 'u1', 'new-profile');
    });

    it('relê o usuário DENTRO da trava (não usa o objeto lido antes dela)', async () => {
      jest.spyOn(lastPermissionHolderUtil, 'assertNotLastHolderOfPermission').mockResolvedValue(undefined);
      jest.spyOn(profileAssignmentUtil, 'reassignUserProfile').mockResolvedValue(undefined);
      const { prisma: localPrisma, tx } = makeTxPrisma('current-profile');
      const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

      await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

      expect(tx.user.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'u1' } });
    });

    it('chama a trava se o perfil atual concedia usuarios.gerenciar e o novo não', async () => {
      const assertNotLastHolderOfPermissionSpy = jest
        .spyOn(lastPermissionHolderUtil, 'assertNotLastHolderOfPermission')
        .mockResolvedValue(undefined);
      jest.spyOn(profileAssignmentUtil, 'reassignUserProfile').mockResolvedValue(undefined);
      const { prisma: localPrisma, tx } = makeTxPrisma('current-profile');
      mockGrants(tx, [], [{ permissionCode: 'usuarios.gerenciar' }]);
      const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

      await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

      expect(assertNotLastHolderOfPermissionSpy).toHaveBeenCalledWith(tx, 'company-1', 'usuarios.gerenciar', 'u1');
    });

    it('não chama a trava se o novo perfil TAMBÉM concede usuarios.gerenciar', async () => {
      const assertNotLastHolderOfPermissionSpy = jest
        .spyOn(lastPermissionHolderUtil, 'assertNotLastHolderOfPermission')
        .mockResolvedValue(undefined);
      jest.spyOn(profileAssignmentUtil, 'reassignUserProfile').mockResolvedValue(undefined);
      const { prisma: localPrisma, tx } = makeTxPrisma('current-profile');
      mockGrants(tx, [{ permissionCode: 'usuarios.gerenciar' }], [{ permissionCode: 'usuarios.gerenciar' }]);
      const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

      await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

      expect(assertNotLastHolderOfPermissionSpy).not.toHaveBeenCalled();
    });

    // Quem gerencia a assinatura (27/09/2026): a mesma trava de último detentor cobre
    // `assinatura.gerenciar` — trocar o perfil do único gestor da assinatura por um sem ela é
    // recusado, igual a `usuarios.gerenciar`.
    it('chama a trava de assinatura.gerenciar se o perfil atual a concedia e o novo não', async () => {
      const spy = jest
        .spyOn(lastPermissionHolderUtil, 'assertNotLastHolderOfPermission')
        .mockResolvedValue(undefined);
      jest.spyOn(profileAssignmentUtil, 'reassignUserProfile').mockResolvedValue(undefined);
      const { prisma: localPrisma, tx } = makeTxPrisma('current-profile');
      mockGrants(tx, [{ permissionCode: 'usuarios.gerenciar' }], [{ permissionCode: 'usuarios.gerenciar' }, { permissionCode: 'assinatura.gerenciar' }]);
      const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

      await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(tx, 'company-1', 'assinatura.gerenciar', 'u1');
    });

    // Achado Important #1 da revisão final da branch (22/09/2026): remover `PATCH .../ponto-access`
    // apagou o gate ("só quem já tem acesso total muda o acesso total de outro ADMIN") e o
    // invariante ("a empresa nunca fica sem NENHUM ADMIN de acesso total"). Ataque demonstrado pelo
    // revisor: um ADMIN restrito se reatribuía ao perfil "Administrador Geral" e recuperava o
    // acesso total da empresa inteira, em dois cliques.
    describe('acesso total ao Ponto (ponto.administrar@EMPRESA)', () => {
      const FULL_PONTO = [{ permissionCode: 'ponto.administrar', scope: 'EMPRESA' }];
      const RESTRITO = [{ permissionCode: 'ponto.administrar', scope: 'EQUIPE' }];

      beforeEach(() => {
        jest.spyOn(lastPermissionHolderUtil, 'assertNotLastHolderOfPermission').mockResolvedValue(undefined);
        jest.spyOn(profileAssignmentUtil, 'reassignUserProfile').mockResolvedValue(undefined);
      });

      it('BARRA (404) um ADMIN restrito tentando GANHAR acesso total — a escalação demonstrada pelo revisor', async () => {
        const { prisma: localPrisma, tx } = makeTxPrisma('current-profile', 'ADMIN');
        mockGrants(tx, FULL_PONTO, RESTRITO);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await expect(
          localService.assignProfile(
            'company-1',
            'u1',
            'new-profile',
            makeCaller({ hasFullPontoAccess: false }),
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('BARRA (404) um chamador EMPLOYEE mexendo no acesso total de um ADMIN', async () => {
        const { prisma: localPrisma, tx } = makeTxPrisma('current-profile', 'ADMIN');
        mockGrants(tx, FULL_PONTO, RESTRITO);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await expect(
          localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller({ role: 'EMPLOYEE' })),
        ).rejects.toThrow(NotFoundException);
      });

      it('PERMITE quando o chamador já tem acesso total', async () => {
        const assertOtherAdminSpy = jest
          .spyOn(lastPermissionHolderUtil, 'assertNotLastAdminWithFullPontoAccess')
          .mockResolvedValue(undefined);
        const { prisma: localPrisma, tx } = makeTxPrisma('current-profile', 'ADMIN');
        mockGrants(tx, FULL_PONTO, RESTRITO);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

        // Ganhar acesso total nunca aciona o invariante de "último detentor" — só perdê-lo aciona.
        expect(assertOtherAdminSpy).not.toHaveBeenCalled();
      });

      it('aciona o invariante ao REBAIXAR um ADMIN que tinha acesso total, excluindo o PRÓPRIO login (nunca o perfil inteiro)', async () => {
        const assertOtherAdminSpy = jest
          .spyOn(lastPermissionHolderUtil, 'assertNotLastAdminWithFullPontoAccess')
          .mockResolvedValue(undefined);
        const { prisma: localPrisma, tx } = makeTxPrisma('current-profile', 'ADMIN');
        mockGrants(tx, RESTRITO, FULL_PONTO);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

        expect(assertOtherAdminSpy).toHaveBeenCalledWith(tx, 'company-1', 'u1');
      });

      it('propaga o BadRequestException do invariante quando o rebaixado era o ÚLTIMO ADMIN de acesso total', async () => {
        jest
          .spyOn(lastPermissionHolderUtil, 'assertNotLastAdminWithFullPontoAccess')
          .mockRejectedValue(new BadRequestException('sem outro admin de acesso total'));
        const { prisma: localPrisma, tx } = makeTxPrisma('current-profile', 'ADMIN');
        mockGrants(tx, RESTRITO, FULL_PONTO);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await expect(
          localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller()),
        ).rejects.toThrow(BadRequestException);
      });

      it('NÃO aciona gate nem invariante quando o alvo é EMPLOYEE (nunca tem acesso total, por definição)', async () => {
        const assertOtherAdminSpy = jest
          .spyOn(lastPermissionHolderUtil, 'assertNotLastAdminWithFullPontoAccess')
          .mockResolvedValue(undefined);
        const { prisma: localPrisma, tx } = makeTxPrisma('current-profile', 'EMPLOYEE');
        mockGrants(tx, RESTRITO, FULL_PONTO);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        // Chamador sem acesso total: passaria batido só porque o alvo é EMPLOYEE.
        await localService.assignProfile(
          'company-1',
          'u1',
          'new-profile',
          makeCaller({ hasFullPontoAccess: false }),
        );

        expect(assertOtherAdminSpy).not.toHaveBeenCalled();
      });

      // Achado da re-revisão (22/09/2026): todo este bloco de ADMIN vivia aninhado dentro de
      // `if (freshUser.profileId)`, então um login SEM perfil (`profileId: null`, alcançável pelo
      // `onDelete: SetNull` da FK — o mesmo cenário do fix de profileId vazio) escapava do gate por
      // completo justamente ao ser promovido pra um perfil de acesso total.
      it('BARRA (404) promover um login SEM perfil (profileId null) a um perfil de acesso total', async () => {
        const { prisma: localPrisma, tx } = makeTxPrisma(null, 'ADMIN');
        mockGrants(tx, FULL_PONTO, []);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await expect(
          localService.assignProfile(
            'company-1',
            'u1',
            'new-profile',
            makeCaller({ hasFullPontoAccess: false }),
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('PERMITE a mesma promoção de um login sem perfil quando o chamador tem acesso total', async () => {
        const assertOtherAdminSpy = jest
          .spyOn(lastPermissionHolderUtil, 'assertNotLastAdminWithFullPontoAccess')
          .mockResolvedValue(undefined);
        const { prisma: localPrisma, tx } = makeTxPrisma(null, 'ADMIN');
        mockGrants(tx, FULL_PONTO, []);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

        expect(assertOtherAdminSpy).not.toHaveBeenCalled();
      });

      it('NÃO chama a trava de usuarios.gerenciar para um login sem perfil anterior', async () => {
        const assertNotLastHolderSpy = jest
          .spyOn(lastPermissionHolderUtil, 'assertNotLastHolderOfPermission')
          .mockResolvedValue(undefined);
        const { prisma: localPrisma, tx } = makeTxPrisma(null, 'ADMIN');
        mockGrants(tx, FULL_PONTO, []);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await localService.assignProfile('company-1', 'u1', 'new-profile', makeCaller());

        expect(assertNotLastHolderSpy).not.toHaveBeenCalled();
      });

      it('NÃO aciona gate nem invariante quando o acesso total não muda (os dois perfis dão acesso total)', async () => {
        const assertOtherAdminSpy = jest
          .spyOn(lastPermissionHolderUtil, 'assertNotLastAdminWithFullPontoAccess')
          .mockResolvedValue(undefined);
        const { prisma: localPrisma, tx } = makeTxPrisma('current-profile', 'ADMIN');
        mockGrants(tx, FULL_PONTO, FULL_PONTO);
        const localService = new UsersService(localPrisma as any, makeTimeAuth(), inviteMailer as any, userTokens as any, email as any, makeAuthz());

        await localService.assignProfile(
          'company-1',
          'u1',
          'new-profile',
          makeCaller({ hasFullPontoAccess: false }),
        );

        expect(assertOtherAdminSpy).not.toHaveBeenCalled();
      });
    });
  });
  // Concessão limitada (28/09/2026): quem gerencia acessos só concede o que o próprio perfil também
  // tem, e só age sobre logins cujo perfil atual está dentro do seu poder (lido do BANCO).
  describe('concessão limitada (no-escalation)', () => {
    const GRANT_MSG = (labels: string) => `Você só pode dar permissões que o seu próprio perfil também tem: ${labels}.`;
    const LOGIN_MSG = 'Este login tem permissões que o seu perfil não tem. Só quem tem todas elas pode alterá-lo.';

    // Chamador "gerente de RH": gerencia usuários e vê funcionários do time, nada mais.
    const LIMITED_CALLER = { 'usuarios.gerenciar': 'EMPRESA', 'funcionarios.ver': 'EQUIPE' };
    const ABOVE = [{ permissionCode: 'pagamentos.gerenciar', scope: 'EMPRESA' }];
    const WITHIN = [{ permissionCode: 'funcionarios.ver', scope: 'EQUIPE' }];

    function useLimitedCaller(profileGrants: Record<string, { permissionCode: string; scope: string | null }[]>) {
      authz.getEffectivePermissions.mockResolvedValue(LIMITED_CALLER);
      authz.getProfileGrants.mockImplementation((_c: string, profileId: string | null) =>
        Promise.resolve(profileId ? (profileGrants[profileId] ?? []) : []),
      );
    }

    async function expectPermissionRequired(promise: Promise<unknown>, message: string) {
      const err: any = await promise.catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toEqual({ statusCode: 403, code: 'PERMISSION_REQUIRED', message });
    }

    function expectNothingWrittenOrSent() {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(userTokens.issue).not.toHaveBeenCalled();
      expect(inviteMailer.sendInvite).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    }

    const TARGET_ABOVE = { id: 'u2', companyId: 'c1', email: 'b@b.com', role: 'EMPLOYEE', status: 'ACTIVE', profileId: 'p-above', employeeId: null, hasFullPontoAccess: false };

    it('create: perfil acima do chamador → 403 listando os rótulos, nada gravado nem enviado', async () => {
      useLimitedCaller({ 'p-above': [...ABOVE, ...WITHIN] });
      prisma.employee.findFirst.mockResolvedValue({ id: 'e1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(0);
      prisma.company.findUniqueOrThrow.mockResolvedValue({ planTier: 'EMPRESARIAL', name: 'X' });
      prisma.profile.findFirst.mockResolvedValue({ id: 'p-above', name: 'Financeiro', isProtected: false });

      await expectPermissionRequired(
        service.create('c1', { email: 'n@n.com', role: 'EMPLOYEE', employeeId: 'e1', profileId: 'p-above' } as any, makeCaller({ role: 'EMPLOYEE', userId: 'me' })),
        GRANT_MSG('Gerenciar pagamentos de Funcionários'),
      );
      expect(authz.getEffectivePermissions).toHaveBeenCalledWith('me');
      expect(authz.getProfileGrants).toHaveBeenCalledWith('c1', 'p-above');
      expectNothingWrittenOrSent();
    });

    it('create: vale também pra chamador de papel ADMIN (sem exceção por papel)', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.profile.findFirst.mockResolvedValue({ id: 'p-above', name: 'Financeiro', isProtected: false });

      await expectPermissionRequired(
        service.create('c1', { email: 'n@n.com', role: 'ADMIN', profileId: 'p-above' } as any, makeCaller({ role: 'ADMIN' })),
        GRANT_MSG('Gerenciar pagamentos de Funcionários'),
      );
      expectNothingWrittenOrSent();
    });

    it('assignProfile: login alvo acima do chamador → 403 do login, sem transação', async () => {
      useLimitedCaller({ 'p-above': ABOVE, 'p-within': WITHIN });
      prisma.user.findFirst.mockResolvedValue(TARGET_ABOVE);
      prisma.profile.findFirst.mockResolvedValue({ id: 'p-within', name: 'Time', isProtected: false });

      await expectPermissionRequired(service.assignProfile('c1', 'u2', 'p-within', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
    });

    it('assignProfile: perfil novo acima do chamador → 403 listando os rótulos, sem transação', async () => {
      useLimitedCaller({ 'p-within': WITHIN, 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue({ ...TARGET_ABOVE, profileId: 'p-within' });
      prisma.profile.findFirst.mockResolvedValue({ id: 'p-above', name: 'Financeiro', isProtected: false });

      await expectPermissionRequired(
        service.assignProfile('c1', 'u2', 'p-above', makeCaller()),
        GRANT_MSG('Gerenciar pagamentos de Funcionários'),
      );
      expectNothingWrittenOrSent();
    });

    it('block: login acima do chamador → 403, sem transação', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue(TARGET_ABOVE);
      await expectPermissionRequired(service.block('c1', 'u2', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('unblock: login acima do chamador → 403, nada gravado', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue({ ...TARGET_ABOVE, status: 'BLOCKED' });
      await expectPermissionRequired(service.unblock('c1', 'u2', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
    });

    it('remove: login acima do chamador → 403, nada excluído', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue(TARGET_ABOVE);
      await expectPermissionRequired(service.remove('c1', 'u2', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
    });

    it('resetPassword (ACTIVE): login acima do chamador → 403, sem token nem e-mail', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue(TARGET_ABOVE);
      await expectPermissionRequired(service.resetPassword('c1', 'u2', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
    });

    it('resetPassword (INVITED): login acima do chamador → 403, sem convite', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue({ ...TARGET_ABOVE, status: 'INVITED' });
      await expectPermissionRequired(service.resetPassword('c1', 'u2', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
    });

    it('resendInvite: login acima do chamador → 403, sem convite', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue({ ...TARGET_ABOVE, status: 'INVITED' });
      await expectPermissionRequired(service.resendInvite('c1', 'u2', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
    });

    it('linkEmployee: login acima do chamador → 403, nada vinculado', async () => {
      useLimitedCaller({ 'p-above': ABOVE });
      prisma.user.findFirst.mockResolvedValue(TARGET_ABOVE);
      await expectPermissionRequired(service.linkEmployee('c1', 'u2', 'e1', makeCaller()), LOGIN_MSG);
      expectNothingWrittenOrSent();
    });

    it('404 de login inexistente continua vindo antes da checagem de poder', async () => {
      useLimitedCaller({});
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.block('c1', 'nope', makeCaller())).rejects.toBeInstanceOf(NotFoundException);
      expect(authz.getEffectivePermissions).not.toHaveBeenCalled();
    });

    it('login alvo dentro do poder do chamador (ou sem perfil) segue normalmente', async () => {
      useLimitedCaller({ 'p-within': WITHIN });
      prisma.user.findFirst.mockResolvedValue({ ...TARGET_ABOVE, profileId: 'p-within' });
      await service.resetPassword('c1', 'u2', makeCaller({ role: 'EMPLOYEE' }));
      expect(userTokens.issue).toHaveBeenCalledWith('u2', 'PASSWORD_RESET');

      prisma.user.findFirst.mockResolvedValue({ ...TARGET_ABOVE, profileId: null });
      await service.resetPassword('c1', 'u2', makeCaller({ role: 'EMPLOYEE' }));
      expect(userTokens.issue).toHaveBeenCalledTimes(2);
    });

    it('um chamador tipo Administrador Geral (padrão dos testes) passa por toda checagem de poder', async () => {
      const everything = PERMISSION_CATALOG.map((p) => ({ permissionCode: p.code, scope: p.validScopes.includes('EMPRESA') ? 'EMPRESA' : null }));
      authz.getProfileGrants.mockResolvedValue(everything);
      prisma.user.findFirst.mockResolvedValue({ ...TARGET_ABOVE, profileId: 'p-all' });
      await service.resetPassword('c1', 'u2', makeCaller());
      expect(userTokens.issue).toHaveBeenCalledWith('u2', 'PASSWORD_RESET');
    });
  });
});
