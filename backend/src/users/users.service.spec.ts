import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: { findFirst: jest.fn() },
      user: {
        findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(),
        create: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn(), delete: jest.fn(),
      },
      company: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
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
      // Chamado por assertNotLastHolderOfPermission (Task 8) — mock default retorna count >= 2
      // (seguro para block/remove), permitindo que testes genéricos passem sem mockagem adicional.
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ count: 2n }]),
    };
    const module = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(UsersService);
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
    prisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'c1', maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.create.mockResolvedValue({ id: 'u9', role: 'EMPLOYEE', hasFullPontoAccess: true });

    const { user } = await service.create('c1', { email: 'f@a.com', role: 'EMPLOYEE', employeeId: 'emp-1', modules: ['RH'] } as any);

    expect(user.hasFullPontoAccess).toBe(false);
  });

  it('create never selects passwordHash back for the created user', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin3@a.com', role: 'ADMIN' });
    await service.create('c1', { email: 'admin3@a.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any);
    const call = prisma.user.create.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.passwordHash).toBeUndefined();
  });

  it('rejects creating an EMPLOYEE login without employeeId', async () => {
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login for an employee from another company', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating a second login for an employee that already has one', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating an EMPLOYEE login once the plan limit is reached', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(10);
    await expect(service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates an EMPLOYEE login under the plan limit and returns the fixed temporary password', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(9);
    prisma.user.create.mockResolvedValue({ id: 'u1', email: 'a@a.com', role: 'EMPLOYEE' });
    const result = await service.create('c1', { email: 'a@a.com', role: 'EMPLOYEE', employeeId: 'e1', modules: ['RH'] } as any);
    // Decisão de produto: senha temporária FIXA e conhecida ('Mudar@123'),
    // não mais aleatória — o bloqueio de acesso até a troca fica a cargo de
    // mustChangePassword (ver JwtAuthGuard), não da imprevisibilidade da
    // senha em si.
    expect(result.temporaryPassword).toBe('Mudar@123');
    expect(result.user.id).toBe('u1');
  });

  it('hashes the fixed temporary password instead of persisting it in plaintext', async () => {
    prisma.user.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'u9', email: data.email, role: data.role }));
    const result = await service.create('c1', { email: 'admin9@a.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any);
    const createCall = prisma.user.create.mock.calls[0][0];
    expect(createCall.data.passwordHash).not.toBe('Mudar@123');
    expect(createCall.data.mustChangePassword).toBe(true);
    expect(result.temporaryPassword).toBe('Mudar@123');
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
      service.create('c1', { email: 'ja-existe-em-outra-empresa@test.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a race on employeeId with the specific message, not the e-mail one, using err.meta.target', async () => {
    // O pre-check `existingLogin` já cobre o caso comum — este teste cobre a corrida real (duas
    // requisições passam o pre-check antes de qualquer uma escrever), disambiguada por
    // err.meta.target em vez de assumir sempre que um P2002 aqui é sobre e-mail.
    prisma.employee.findFirst.mockResolvedValue({ id: 'e1', companyId: 'c1' });
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.company.findUniqueOrThrow.mockResolvedValue({ maxEmployeeLogins: 10 });
    prisma.user.count.mockResolvedValue(0);
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`employeeId`)', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['employeeId'] },
      }),
    );
    await expect(
      service.create('c1', { email: 'novo@test.com', role: 'EMPLOYEE', employeeId: 'e1', modules: [] } as any),
    ).rejects.toThrow('Este funcionário já está vinculado a outro login');
  });

  it('creates an ADMIN login without checking the employee-linked plan limit', async () => {
    prisma.user.create.mockResolvedValue({ id: 'u2', email: 'admin2@a.com', role: 'ADMIN' });
    const result = await service.create('c1', { email: 'admin2@a.com', role: 'ADMIN', modules: ['DASHBOARD'] } as any);
    expect(result.user.id).toBe('u2');
    expect(prisma.company.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('block scopes the lookup to the current company and revokes active refresh tokens', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', role: 'EMPLOYEE', status: 'ACTIVE' });
    await service.block('c1', 'u1');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('block 404s for a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.block('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(NotFoundException);
  });

  // Achado durante a auditoria de segurança (17/09/2026) — mesmo invariante que updatePontoAccess já
  // protegia ("pelo menos um admin de acesso total"), agora estendido a "pelo menos um ADMIN ATIVO":
  // sem isso, bloquear o último admin ativo deixaria a empresa sem ninguém pra desbloquear ninguém.
  it('block rejects blocking the last ACTIVE ADMIN of the company', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
    prisma.user.count.mockResolvedValue(1);
    await expect(service.block('c1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('block allows blocking an ADMIN when at least one other ACTIVE ADMIN remains', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
    prisma.user.count.mockResolvedValue(2);
    await service.block('c1', 'admin1');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'admin1' }, data: { status: 'BLOCKED' } });
  });

  it('unblock 404s for a user from another company', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.unblock('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unblock resets status to ACTIVE and zeroes the failed-login-attempts counter', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
    await service.unblock('c1', 'u1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'ACTIVE', failedLoginAttempts: 0 },
    });
  });

  describe('update', () => {
    it('404s for a login from another company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.update('c1', 'u-outra-empresa', { modules: [] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates the modules of an existing login without recreating it', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
      prisma.user.update.mockResolvedValue({ id: 'u1', role: 'EMPLOYEE', modules: ['PONTO_REGISTRO'], hasFullPontoAccess: true });
      const result = await service.update('c1', 'u1', { modules: ['PONTO_REGISTRO'] } as any);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { modules: ['PONTO_REGISTRO'] },
        select: expect.any(Object),
      });
      expect(result.modules).toEqual(['PONTO_REGISTRO']);
    });
  });

  describe('remove', () => {
    it('404s for a login from another company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.remove('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects deleting the last ACTIVE ADMIN of the company', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'admin1', companyId: 'c1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin1', role: 'ADMIN', status: 'ACTIVE' });
      prisma.user.count.mockResolvedValue(1);
      await expect(service.remove('c1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('deletes a login for real (not a status change) when it is not the last active admin', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'u1', role: 'EMPLOYEE', status: 'ACTIVE' });
      await service.remove('c1', 'u1');
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    });
  });

  describe('resetPassword', () => {
    it('404s for a login from another company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.resetPassword('c1', 'u-outra-empresa')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('generates the same fixed temporary password used at creation, reactivates the login and zeroes the failed-attempt counter', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', companyId: 'c1' });
      const result = await service.resetPassword('c1', 'u1');
      expect(result.temporaryPassword).toBe('Mudar@123');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          mustChangePassword: true,
          status: 'ACTIVE',
          failedLoginAttempts: 0,
        }),
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('updatePontoAccess', () => {
    it('turns hasFullPontoAccess on for a target ADMIN login in the same company', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'ADMIN', hasFullPontoAccess: false });
      prisma.user.count.mockResolvedValue(2); // irrelevant when turning ON, only checked when turning OFF
      prisma.user.update.mockResolvedValue({ id: 'target-1' });

      await service.updatePontoAccess('company-1', 'target-1', true);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target-1' }, data: { hasFullPontoAccess: true } });
    });

    it('rejects turning it off when the target is the last ADMIN with hasFullPontoAccess: true in the company', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'ADMIN', hasFullPontoAccess: true });
      prisma.user.count.mockResolvedValue(1); // only this one left

      await expect(service.updatePontoAccess('company-1', 'target-1', false)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows turning it off when at least one other full-access ADMIN remains', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'ADMIN', hasFullPontoAccess: true });
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue({ id: 'target-1' });

      await service.updatePontoAccess('company-1', 'target-1', false);

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target-1' }, data: { hasFullPontoAccess: false } });
    });

    it('throws NotFoundException when the target does not exist in this company', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.updatePontoAccess('company-1', 'target-1', true)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when the target is not an ADMIN login', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'target-1', companyId: 'company-1', role: 'EMPLOYEE', hasFullPontoAccess: true });
      await expect(service.updatePontoAccess('company-1', 'target-1', false)).rejects.toBeInstanceOf(BadRequestException);
    });

    // Regressão do achado de revisão (15/09/2026): a versão original fazia count() e update() como
    // duas queries separadas, SEM nenhuma trava — duas requisições concorrentes desligando dois
    // admins DIFERENTES, com exatamente 2 full-access admins restantes, podiam ambas ler
    // count === 2, ambas passar o guard, e ambas escrever false, zerando os admins de acesso total
    // da empresa (estado irrecuperável sem acesso direto ao banco). Simula a corrida real via
    // mockResolvedValueOnce sequencial (mesmo padrão da regressão equivalente em
    // time-clock.service.spec.ts para a corrida de marcação duplicada): a PRIMEIRA tentativa a
    // recontar (dentro do lock) ainda vê os 2 admins originais e escreve; a SEGUNDA só recontra
    // DEPOIS (a mesma trava — pg_advisory_xact_lock escopado por companyId — serializa as duas) e
    // já vê 1, refletindo o commit da primeira, sendo corretamente rejeitada.
    it('serializes two concurrent attempts to turn off two different admins when exactly 2 remain — exactly one succeeds, one is rejected', async () => {
      prisma.user.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, companyId: 'company-1', role: 'ADMIN', hasFullPontoAccess: true }),
      );
      prisma.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
      prisma.user.update.mockResolvedValue({ id: 'updated' });

      const results = await Promise.allSettled([
        service.updatePontoAccess('company-1', 'target-1', false),
        service.updatePontoAccess('company-1', 'target-2', false),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      // Só a vencedora chega a escrever — a perdedora é barrada pela recontagem, dentro do lock,
      // antes de qualquer update.
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'target-1' }, data: { hasFullPontoAccess: false } });
      // As duas tentativas de fato disputaram o lock (não só a vencedora) e as duas recontaram —
      // é essa recontagem-dentro-do-lock, e não uma checagem antiga em cache, que barra a segunda.
      // 4, não 2: cada tentativa agora emite 2 chamadas a $executeRaw (o set_config manual de RLS
      // — ver o achado da auditoria de segurança de 17/09/2026 — e o pg_advisory_xact_lock em si).
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);
      expect(prisma.user.count).toHaveBeenCalledTimes(2);
    });
  });
});
