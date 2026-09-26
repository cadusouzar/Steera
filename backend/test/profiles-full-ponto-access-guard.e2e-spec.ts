import { BadRequestException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Scope } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem, runWithTenant } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';
import { ProfilesService } from '../src/profiles/profiles.service';
import { TimeManagementAuthService } from '../src/time-management/time-management-auth.service';
import { AuthenticatedUser } from '../src/auth/decorators/current-user.decorator';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

/**
 * Prova, contra Postgres real (não mockado), das DUAS proteções restauradas na revisão final desta
 * branch (Fase 2a, 22/09/2026, Important #1). Remover `PATCH /companies/me/users/:id/ponto-access`
 * (substituído pela derivação de `hasFullPontoAccess` a partir do Perfil) apagou junto, sem
 * substituto, as duas propriedades de segurança que aquele endpoint carregava desde 15/09/2026:
 *
 *   (a) GATE — só um ADMIN que JÁ tem acesso total ao Ponto pode mudar o acesso total de outro
 *       ADMIN. Sem isso, o revisor demonstrou a escalação: um ADMIN restrito abre
 *       `/app/usuarios`, se reatribui ao perfil "Administrador Geral" (que concede
 *       `ponto.administrar@EMPRESA`) e recupera a administração de Ponto da empresa inteira em
 *       dois cliques.
 *   (b) INVARIANTE — a empresa nunca fica com ZERO logins ADMIN de acesso total. Aqui o caminho
 *       perigoso é o de LOTE: editar um Perfil compartilhado por vários ADMINs, rebaixando
 *       `ponto.administrar` de EMPRESA pra EQUIPE, zerava todos eles de uma vez — exatamente a
 *       mesma classe de bug já achada e corrigida nesta branch pra `usuarios.gerenciar` (ver
 *       `profiles-shared-permission-guard.e2e-spec.ts`).
 *
 * Como nos outros dois arquivos de trava deste plano, `ProfilesService` é chamado diretamente
 * (envolto em `runWithTenant`) para o caminho de LOTE, e o caminho de UM usuário
 * (`assignProfile`) é exercitado por HTTP de verdade, com um login ADMIN restrito real, pra
 * provar também a fiação do controller (o `currentUser` novo chegando ao service).
 */
describe('Acesso total ao Ponto — gate + invariante de último ADMIN (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let profiles: ProfilesService;
  let companyId: string;
  let adminToken: string;
  let administradorGeralId: string;

  const runId = Date.now();
  const adminEmail = `ponto-guard-admin-${runId}@test.com`;

  // Chamador de acesso total: passa pelo gate, então exercita o INVARIANTE.
  function fullAccessCaller(): AuthenticatedUser {
    return {
      userId: 'e2e-caller',
      companyId,
      role: 'ADMIN',
      modules: [],
      mustChangePassword: false,
      hasFullPontoAccess: true,
      permissions: {},
    };
  }

  // Chamador restrito: nunca chega ao invariante — é barrado antes, pelo GATE.
  function restrictedCaller(): AuthenticatedUser {
    return { ...fullAccessCaller(), hasFullPontoAccess: false };
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }

    app = await bootApp();
    prisma = app.get(PrismaService);
    profiles = new ProfilesService(prisma, new TimeManagementAuthService(prisma));

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Ponto Guard Co', email: adminEmail, password: 'senha-de-teste-12345' }))
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = founder.companyId;
    administradorGeralId = founder.profileId!;
    await markEmailVerified(prisma, adminEmail);

    // Precondição do cenário de desastre: tira `ponto.administrar` do perfil protegido do fundador
    // (mutado direto no banco — perfil protegido não é editável por `update()`), pra ele deixar de
    // contar como "outro perfil que ainda dá acesso total a um ADMIN ativo". O token do fundador
    // continua valendo (claims já emitidas), o que é justamente o que queremos: um chamador de
    // acesso total pra exercitar o invariante.
    await sys(() =>
      prisma.profilePermission.deleteMany({
        where: { companyId, profileId: administradorGeralId, permissionCode: 'ponto.administrar' },
      }),
    );
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId } }));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  // Aceita o convite na hora, com uma senha padrão (sobrescrevível pelos 3 chamadores que de fato
  // precisam logar com este login) — "Acesso e sessões" (26/09/2026): login criado por um admin
  // nasce INVITED, e `countFullPontoAdmins()`/todo guard de último detentor abaixo só conta login
  // ACTIVE. Sem aceitar, este login nunca contaria como "detentor", quebrando a precondição que
  // praticamente todo teste deste arquivo monta.
  async function createAdmin(label: string, profileId = administradorGeralId, password = 'senha-padrao-123456') {
    const email = `${label}-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email, role: 'ADMIN', profileId })
      .expect(201);
    await acceptInvite(app, res.body.inviteUrl, password);
    return { id: res.body.user.id as string, email, password };
  }

  // Via a API de modelo do Prisma (nunca `$queryRawUnsafe`) — mesmo motivo já documentado nos
  // outros arquivos de trava: SQL bruto não passa pela extensão de RLS/roteamento deste projeto e,
  // sob `sys()`, voltaria zero silenciosamente.
  function countFullPontoAdmins(): Promise<number> {
    return sys(() =>
      prisma.user.count({
        where: {
          companyId,
          status: 'ACTIVE',
          role: 'ADMIN',
          profile: { permissions: { some: { permissionCode: 'ponto.administrar', scope: Scope.EMPRESA } } },
        },
      }),
    );
  }

  const FULL_PONTO = [{ permissionCode: 'ponto.administrar', scope: Scope.EMPRESA }];
  const PONTO_DE_EQUIPE = [{ permissionCode: 'ponto.administrar', scope: Scope.EQUIPE }];

  let pontoTotalId: string;
  let extraId: string;
  let extraAdminId: string;
  let secondExtraAdminId: string;

  it('rejeita (400) e NÃO aplica nada ao rebaixar o ÚNICO perfil que dá acesso total a 2 ADMINs ativos', async () => {
    const pontoTotal = await runWithTenant(companyId, () =>
      profiles.create(companyId, { name: 'Ponto Total', grants: FULL_PONTO }),
    );
    pontoTotalId = pontoTotal.id;

    const a = await createAdmin('fullponto-a');
    const b = await createAdmin('fullponto-b');
    await sys(() => prisma.user.update({ where: { id: a.id }, data: { profileId: pontoTotalId, hasFullPontoAccess: true } }));
    await sys(() => prisma.user.update({ where: { id: b.id }, data: { profileId: pontoTotalId, hasFullPontoAccess: true } }));

    // Precondição confirmada: exatamente 2 ADMINs de acesso total, os dois via "Ponto Total".
    expect(await countFullPontoAdmins()).toBe(2);

    await expect(
      runWithTenant(companyId, () =>
        profiles.update(companyId, pontoTotalId, { name: 'Ponto Total', grants: PONTO_DE_EQUIPE }, fullAccessCaller()),
      ),
    ).rejects.toThrow(BadRequestException);

    // Transação inteira revertida — nada parcialmente aplicado.
    const grantsAfter = await sys(() => prisma.profilePermission.findMany({ where: { profileId: pontoTotalId } }));
    expect(grantsAfter).toHaveLength(1);
    expect(grantsAfter[0].scope).toBe(Scope.EMPRESA);
    expect(await countFullPontoAdmins()).toBe(2);

    const aAfter = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: a.id } }));
    expect(aAfter.hasFullPontoAccess).toBe(true);
    expect(aAfter.profileId).toBe(pontoTotalId);
  });

  it('BARRA (404) um chamador ADMIN restrito antes mesmo do invariante — o GATE', async () => {
    await expect(
      runWithTenant(companyId, () =>
        profiles.update(companyId, pontoTotalId, { name: 'Ponto Total', grants: PONTO_DE_EQUIPE }, restrictedCaller()),
      ),
    ).rejects.toThrow(NotFoundException);

    // Também aqui nada foi escrito.
    const grantsAfter = await sys(() => prisma.profilePermission.findMany({ where: { profileId: pontoTotalId } }));
    expect(grantsAfter[0].scope).toBe(Scope.EMPRESA);
  });

  it('permite o rebaixamento quando OUTRO perfil ainda dá acesso total a um ADMIN ativo, e recalcula os rebaixados', async () => {
    const extra = await runWithTenant(companyId, () =>
      profiles.create(companyId, { name: 'Extra Ponto', grants: FULL_PONTO }),
    );
    extraId = extra.id;

    const c = await createAdmin('fullponto-c');
    extraAdminId = c.id;
    await sys(() => prisma.user.update({ where: { id: c.id }, data: { profileId: extraId, hasFullPontoAccess: true } }));
    expect(await countFullPontoAdmins()).toBe(3);

    const updated = await runWithTenant(companyId, () =>
      profiles.update(companyId, pontoTotalId, { name: 'Ponto Total', grants: PONTO_DE_EQUIPE }, fullAccessCaller()),
    );
    expect(updated.grants.find((g) => g.permissionCode === 'ponto.administrar')?.scope).toBe(Scope.EQUIPE);

    // Só o admin de "Extra Ponto" segue com acesso total — e os dois rebaixados tiveram a coluna
    // `hasFullPontoAccess` recalculada de verdade (recomputeAndSaveUserAccess), não só o perfil.
    expect(await countFullPontoAdmins()).toBe(1);
    const demoted = await sys(() => prisma.user.findMany({ where: { profileId: pontoTotalId } }));
    expect(demoted).toHaveLength(2);
    expect(demoted.every((u) => u.hasFullPontoAccess === false)).toBe(true);
  });

  it('BARRA com 404 um ADMIN restrito que tenta se reatribuir a um perfil de acesso total (a escalação demonstrada pelo revisor)', async () => {
    const restrito = await runWithTenant(companyId, () =>
      profiles.create(companyId, { name: 'Admin Restrito no Ponto', grants: PONTO_DE_EQUIPE }),
    );
    const restrictedAdmin = await createAdmin('restrito-http', restrito.id, 'senha-propria-12345');

    // O convite já foi aceito dentro de createAdmin() — só loga.
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: restrictedAdmin.email, password: restrictedAdmin.password })
      .expect(201);
    const restrictedToken = `Bearer ${loginRes.body.accessToken}`;

    // O token reflete a derivação do Perfil: ADMIN, porém SEM acesso total ao Ponto.
    // (`PATCH /auth/me/password` devolve só `accessToken` — o `user` vem de `/auth/me`.)
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', restrictedToken)
      .expect(200);
    expect(meRes.body.role).toBe('ADMIN');
    expect(meRes.body.hasFullPontoAccess).toBe(false);

    // O ataque: ele mesmo se promovendo ao perfil de acesso total.
    await request(app.getHttpServer())
      .patch(`/companies/me/users/${restrictedAdmin.id}/profile`)
      .set('Authorization', restrictedToken)
      .send({ profileId: extraId })
      .expect(404);

    const unchanged = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: restrictedAdmin.id } }));
    expect(unchanged.profileId).toBe(restrito.id);
    expect(unchanged.hasFullPontoAccess).toBe(false);

    // Mesma requisição, feita por quem JÁ tem acesso total (o fundador): permitida.
    await request(app.getHttpServer())
      .patch(`/companies/me/users/${restrictedAdmin.id}/profile`)
      .set('Authorization', adminToken)
      .send({ profileId: extraId })
      .expect(204);

    const promoted = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: restrictedAdmin.id } }));
    expect(promoted.profileId).toBe(extraId);
    expect(promoted.hasFullPontoAccess).toBe(true);
    secondExtraAdminId = restrictedAdmin.id;
  });

  // Regressão achada ao rodar a suíte e2e COMPLETA desta rodada de correção (22/09/2026): a brief
  // mandava usar, em `assignProfile`, a mesma checagem de LOTE usada em `ProfilesService` (que
  // exclui o `profileId` inteiro da contagem). Pra uma ação de UM usuário isso é estrito demais —
  // descarta os OUTROS admins que compartilham aquele mesmo perfil e que NÃO estão sendo movidos.
  // `test/profiles.e2e-spec.ts` (verde antes, vermelho depois) provou o estrago: mover UM admin pra
  // fora do "Administrador Geral" compartilhado passou a dar 400 mesmo com outro admin intacto lá.
  // Corrigido com `assertNotLastAdminWithFullPontoAccess` (exclui o USUÁRIO). Estes dois testes
  // travam a distinção nos dois sentidos.
  it('PERMITE mover UM admin pra fora de um perfil de acesso total quando OUTRO admin continua no MESMO perfil', async () => {
    // Precondição: `extraAdminId` e `secondExtraAdminId` compartilham "Extra Ponto".
    const holders = await sys(() => prisma.user.findMany({ where: { profileId: extraId, role: 'ADMIN' } }));
    expect(holders).toHaveLength(2);

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${extraAdminId}/profile`)
      .set('Authorization', adminToken)
      .send({ profileId: pontoTotalId })
      .expect(204);

    const moved = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: extraAdminId } }));
    expect(moved.hasFullPontoAccess).toBe(false);
    // O que ficou pra trás segue com acesso total — era justamente ele que a checagem de LOTE
    // descartava por engano.
    expect(await countFullPontoAdmins()).toBe(1);
  });

  it('REJEITA (400) mover o ÚLTIMO admin de acesso total da empresa', async () => {
    expect(await countFullPontoAdmins()).toBe(1);

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${secondExtraAdminId}/profile`)
      .set('Authorization', adminToken)
      .send({ profileId: pontoTotalId })
      .expect(400);

    const unchanged = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: secondExtraAdminId } }));
    expect(unchanged.profileId).toBe(extraId);
    expect(unchanged.hasFullPontoAccess).toBe(true);
    expect(await countFullPontoAdmins()).toBe(1);
  });

  // Achado CRÍTICO da re-revisão (22/09/2026) — o exploit que faltava, agora provado fechado sobre
  // HTTP real. Não precisa de nenhuma precondição especial: `ProfilesController` é `@Roles('ADMIN')`
  // e nada mais, e o perfil de um ADMIN restrito é `isProtected: false`, então ele podia editar o
  // PRÓPRIO perfil adicionando `ponto.administrar@EMPRESA`. A primeira versão do gate só olhava o
  // sentido do REBAIXAMENTO, então nenhuma checagem rodava nesse caminho e o `hasFullPontoAccess`
  // dele virava `true` no token seguinte.
  it('BARRA com 404 um ADMIN restrito que edita o PRÓPRIO perfil pra CONCEDER acesso total', async () => {
    const autoPromocao = await runWithTenant(companyId, () =>
      profiles.create(companyId, { name: 'Auto Promoção', grants: PONTO_DE_EQUIPE }),
    );
    expect(autoPromocao.isProtected).toBe(false); // nada protege o próprio perfil dele

    const selfPromoter = await createAdmin('auto-promocao', autoPromocao.id, 'senha-propria-54321');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: selfPromoter.email, password: selfPromoter.password })
      .expect(201);
    const selfToken = `Bearer ${loginRes.body.accessToken}`;

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', selfToken)
      .expect(200);
    expect(meRes.body.role).toBe('ADMIN');
    expect(meRes.body.hasFullPontoAccess).toBe(false);

    // O ataque: editar o próprio perfil adicionando ponto.administrar@EMPRESA.
    await request(app.getHttpServer())
      .patch(`/profiles/${autoPromocao.id}`)
      .set('Authorization', selfToken)
      .send({ name: 'Auto Promoção', grants: FULL_PONTO })
      .expect(404);

    // Nada foi escrito: o perfil segue concedendo só EQUIPE, e ele segue sem acesso total.
    const grantsAfter = await sys(() => prisma.profilePermission.findMany({ where: { profileId: autoPromocao.id } }));
    expect(grantsAfter).toHaveLength(1);
    expect(grantsAfter[0].permissionCode).toBe('ponto.administrar');
    expect(grantsAfter[0].scope).toBe(Scope.EQUIPE);
    const stillRestricted = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: selfPromoter.id } }));
    expect(stillRestricted.hasFullPontoAccess).toBe(false);

    // A MESMA edição, feita por quem já tem acesso total, é permitida — prova que o 404 acima veio
    // do gate, não de outra checagem qualquer no caminho.
    await request(app.getHttpServer())
      .patch(`/profiles/${autoPromocao.id}`)
      .set('Authorization', adminToken)
      .send({ name: 'Auto Promoção', grants: FULL_PONTO })
      .expect(200);

    const promoted = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: selfPromoter.id } }));
    expect(promoted.hasFullPontoAccess).toBe(true);
  });

  // Achado na 3ª rodada de re-revisão (22/09/2026) — o QUARTO caminho, e o único que cria um login
  // NOVO: `UsersService.create()` derivava `hasFullPontoAccess` do perfil escolhido sem gate
  // nenhum. Sequência do ataque, três chamadas comuns: criar um Perfil com
  // `ponto.administrar@EMPRESA` (inofensivo sozinho), criar um login ADMIN novo apontando pra ele
  // (já nasce com acesso total), e entrar nele aceitando o próprio convite por e-mail.
  it('BARRA com 404 um ADMIN restrito CRIANDO um login ADMIN novo com acesso total', async () => {
    const restrito = await runWithTenant(companyId, () =>
      profiles.create(companyId, { name: 'Restrito Criador', grants: PONTO_DE_EQUIPE }),
    );
    const creator = await createAdmin('criador-restrito', restrito.id, 'senha-propria-98765');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: creator.email, password: creator.password })
      .expect(201);
    const creatorToken = `Bearer ${loginRes.body.accessToken}`;

    // Passo 1 do ataque: criar o perfil de acesso total. Permitido de propósito — um perfil sem
    // ninguém atribuído não concede nada a ninguém.
    const weaponRes = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', creatorToken)
      .send({ name: 'Arma', grants: FULL_PONTO })
      .expect(201);

    // Passo 2: mintar um ADMIN novo já com acesso total — agora barrado.
    const victimEmail = `vitima-${runId}@test.com`;
    await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', creatorToken)
      .send({ email: victimEmail, role: 'ADMIN', profileId: weaponRes.body.id })
      .expect(404);

    // Nenhum login foi criado.
    const notCreated = await sys(() => prisma.user.findUnique({ where: { email: victimEmail } }));
    expect(notCreated).toBeNull();

    // A MESMA criação, feita por quem já tem acesso total, é permitida — prova que o 404 veio do
    // gate, não de outra checagem no caminho.
    const okRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: victimEmail, role: 'ADMIN', profileId: weaponRes.body.id })
      .expect(201);
    expect(okRes.body.user.hasFullPontoAccess).toBe(true);
  });

  it('rejeita (400) um profileId vazio antes de chegar ao service (@IsNotEmpty no DTO)', async () => {
    await request(app.getHttpServer())
      .patch(`/companies/me/users/${(await createAdmin('dto-vazio')).id}/profile`)
      .set('Authorization', adminToken)
      .send({ profileId: '' })
      .expect(400);
  });
});
