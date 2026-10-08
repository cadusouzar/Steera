import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { translateValidationErrors } from '../src/common/validation-message-translator.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { markEmailVerified } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

// LGPD — Etapa A (07/10/2026): aceite dos Termos de uso e da Política de Privacidade, contra o
// Postgres real (quickflow_test). O ponto mais importante que só um e2e prova: register() grava o
// aceite (tabela CENTRAL) dentro da mesma transação que cria o User — um client de tenant ali
// falharia só em runtime.
const sys = <T>(fn: () => Promise<T>) => runAsSystem(fn);
const PASSWORD = 'senha-de-teste-legal-12345';
const CSRF = { 'x-requested-with': 'XMLHttpRequest' };
const MESSAGE = 'Aceite os Termos de uso e a Política de Privacidade para continuar.';
const allow = { canActivate: () => true };

describe('Aceite dos Termos e da Política (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const companyIds: string[] = [];
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const founderEmail = `legal-founder-${runId}@test.com`;
  let founderId: string;
  let companyId: string;

  const http = () => request(app.getHttpServer());
  const rowsOf = (userId: string) =>
    sys(() => prisma.legalAcceptance.findMany({ where: { userId } }));
  const login = async (email: string, password: string) =>
    (await http().post('/auth/login').set(CSRF).send({ email, password }).expect(201)).body;

  beforeAll(async () => {
    if (!/\/quickflow_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard).useValue(allow)
      .overrideGuard(FriendlyThrottlerGuard).useValue(allow)
      .compile();
    app = moduleRef.createNestApplication();
    // cookie-parser como em main.ts (mesmo motivo de access-and-sessions.e2e-spec.ts): sem ele
    // POST /auth/refresh nunca lê o cookie `rt`.
    app.use(cookieParser());
    // Mesmo exceptionFactory de main.ts: a mensagem do aceite precisa chegar como string única.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true, transform: true, forbidNonWhitelisted: true,
        exceptionFactory: (errors) => new BadRequestException(translateValidationErrors(errors)),
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const id of companyIds) {
      const schemaName = await getTenantSchemaName(prisma, id);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId: id } } }));
      // LegalAcceptance/UserToken saem junto (onDelete: Cascade com User).
      await sys(() => prisma.user.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.company.delete({ where: { id } }));
    }
    await app.close();
  });

  it('cadastro sem acceptLegal → 400 com a mensagem do aceite, nada criado', async () => {
    const email = `legal-missing-${runId}@test.com`;
    const body = buildRegisterBody({ companyName: 'Empresa Sem Aceite', email, password: PASSWORD });
    delete body.acceptLegal;
    const res = await http().post('/auth/register').set(CSRF).send(body).expect(400);
    expect(res.body.message).toBe(MESSAGE);

    const resFalse = await http()
      .post('/auth/register')
      .set(CSRF)
      .send({ ...body, acceptLegal: false })
      .expect(400);
    expect(resFalse.body.message).toBe(MESSAGE);
    expect(await sys(() => prisma.user.findUnique({ where: { email } }))).toBeNull();
  });

  it('cadastro com acceptLegal: true grava TERMS e PRIVACY (versão 1, com IP e navegador) na mesma operação', async () => {
    const res = await http()
      .post('/auth/register')
      .set(CSRF)
      .set('User-Agent', 'NavegadorDeTeste/1.0')
      .send(buildRegisterBody({ companyName: 'Empresa Com Aceite', email: founderEmail, password: PASSWORD }))
      .expect(201);
    expect(res.body.user.legalAcceptancePending).toBe(false);

    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: founderEmail } }));
    founderId = founder.id;
    companyId = founder.companyId;
    companyIds.push(companyId);
    await markEmailVerified(prisma, founderEmail);

    const rows = await rowsOf(founderId);
    expect(rows.map((r) => `${r.document}:${r.version}`).sort()).toEqual(['PRIVACY:1', 'TERMS:1']);
    for (const row of rows) {
      expect(row.ip).toBeTruthy();
      expect(row.userAgent).toBe('NavegadorDeTeste/1.0');
    }

    // Sem aceite pendente, o ERP abre normalmente.
    await http().get('/clients').set('Authorization', `Bearer ${(await login(founderEmail, PASSWORD)).accessToken}`).expect(200);
  });

  describe('conta antiga (sem nenhuma linha de aceite)', () => {
    let pendingToken: string;

    beforeAll(async () => {
      await sys(() => prisma.legalAcceptance.deleteMany({ where: { userId: founderId } }));
      const body = await login(founderEmail, PASSWORD);
      expect(body.user.legalAcceptancePending).toBe(true);
      pendingToken = `Bearer ${body.accessToken}`;
    });

    it('GET /auth/me responde 200 com legalAcceptancePending: true', async () => {
      const res = await http().get('/auth/me').set('Authorization', pendingToken).expect(200);
      expect(res.body.legalAcceptancePending).toBe(true);
    });

    it('rotas de negócio respondem 403 LEGAL_ACCEPTANCE_REQUIRED; as de "Minha conta" continuam liberadas', async () => {
      const res = await http().get('/clients').set('Authorization', pendingToken).expect(403);
      expect(res.body).toMatchObject({ code: 'LEGAL_ACCEPTANCE_REQUIRED', message: MESSAGE });

      await http().get('/plans/me').set('Authorization', pendingToken).expect(200);
      await http().patch('/auth/me').set('Authorization', pendingToken).send({ name: 'Responsável' }).expect(200);
    });

    it('POST /auth/me/legal-acceptance sem acceptLegal → 400 com a mensagem, nada gravado', async () => {
      const res = await http().post('/auth/me/legal-acceptance').set('Authorization', pendingToken).send({}).expect(400);
      expect(res.body.message).toBe(MESSAGE);
      expect(await rowsOf(founderId)).toHaveLength(0);
    });

    it('POST /auth/me/legal-acceptance libera o acesso na hora (token novo E o token antigo) e repetir não duplica', async () => {
      const res = await http()
        .post('/auth/me/legal-acceptance')
        .set('Authorization', pendingToken)
        .send({ acceptLegal: true })
        .expect(201);
      expect(res.body.user.legalAcceptancePending).toBe(false);
      expect(typeof res.body.accessToken).toBe('string');
      expect(await rowsOf(founderId)).toHaveLength(2);

      // Token novo, sem a pendência na claim.
      await http().get('/clients').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
      // Token antigo (claim pendente): o guard relê o banco e libera.
      await http().get('/clients').set('Authorization', pendingToken).expect(200);
      const me = await http().get('/auth/me').set('Authorization', pendingToken).expect(200);
      expect(me.body.legalAcceptancePending).toBe(false);

      await http()
        .post('/auth/me/legal-acceptance')
        .set('Authorization', pendingToken)
        .send({ acceptLegal: true })
        .expect(201);
      expect(await rowsOf(founderId)).toHaveLength(2);
    });

    it('refresh depois do aceite emite token sem a pendência', async () => {
      const loginRes = await http().post('/auth/login').set(CSRF).send({ email: founderEmail, password: PASSWORD }).expect(201);
      expect(loginRes.body.user.legalAcceptancePending).toBe(false);
      const cookie = loginRes.headers['set-cookie'];
      const refreshed = await http().post('/auth/refresh').set('Cookie', cookie).expect(201);
      await http().get('/clients').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);
    });
  });

  describe('convite', () => {
    let inviteToken: string;
    let invitedId: string;
    const invitedEmail = `legal-invited-${runId}@test.com`;
    const invitedPassword = 'senha-do-convidado-legal-789';

    beforeAll(async () => {
      const adminToken = `Bearer ${(await login(founderEmail, PASSWORD)).accessToken}`;
      const profile = await sys(() => prisma.profile.findFirstOrThrow({ where: { companyId, isProtected: true } }));
      const res = await http()
        .post('/companies/me/users')
        .set('Authorization', adminToken)
        .send({ email: invitedEmail, role: 'ADMIN', profileId: profile.id })
        .expect(201);
      invitedId = res.body.user.id;
      inviteToken = new URL(res.body.inviteUrl).searchParams.get('token')!;
    });

    it('aceitar o convite sem acceptLegal → 400 com a mensagem, convite continua pendente', async () => {
      const res = await http()
        .post('/auth/accept-invite')
        .set(CSRF)
        .send({ token: inviteToken, password: invitedPassword })
        .expect(400);
      expect(res.body.message).toBe(MESSAGE);
      const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: invitedId } }));
      expect(user.status).toBe('INVITED');
    });

    it('aceitar o convite com acceptLegal: true ativa o login e grava o aceite', async () => {
      await http()
        .post('/auth/accept-invite')
        .set(CSRF)
        .send({ token: inviteToken, password: invitedPassword, acceptLegal: true })
        .expect(204);
      const rows = await rowsOf(invitedId);
      expect(rows.map((r) => r.document).sort()).toEqual(['PRIVACY', 'TERMS']);
      expect(rows.every((r) => r.version === 1 && !!r.ip)).toBe(true);

      const body = await login(invitedEmail, invitedPassword);
      expect(body.user.legalAcceptancePending).toBe(false);
    });
  });
});
