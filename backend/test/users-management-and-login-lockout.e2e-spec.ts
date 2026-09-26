import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { EMAIL_SENDER } from '../src/email/email-sender';
import { FakeEmailSender } from '../src/email/fake-email.sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified, tokenFromLink, waitForEmail } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

const allow = { canActivate: () => true };
const CSRF_HEADER = { 'x-requested-with': 'XMLHttpRequest' };

async function bootApp(fake: FakeEmailSender): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard).useValue(allow)
    .overrideGuard(FriendlyThrottlerGuard).useValue(allow)
    .overrideProvider(EMAIL_SENDER).useValue(fake)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}

// Cobre as features de gestão de login (exclusão, reset de senha pelo admin, bloqueio temporário por
// tentativas erradas, desbloqueio) contra Postgres real — os mesmos call sites de
// UsersService.remove/resetPassword/unblock e AuthService.login usam o padrão de transação central
// manual (ver o comentário completo em AuthService.changePassword), que testes unitários mockados não
// conseguem pegar se a rota real quebrar.
//
// Reescrita para "Acesso e sessões" (26/09/2026): login criado por um admin nasce INVITED (convite
// por e-mail, sem senha temporária fixa — substituída nesta mesma leva de mudanças), e a trava por
// senha errada deixou de ser permanente (`status: 'LOCKED'`, só admin destravava) — agora é temporária
// (`User.lockedUntil`, 15min, com e-mail de aviso e link de redefinição; `status` nunca sai de
// `ACTIVE`). `PATCH .../reset-password` (ação do admin) também parou de devolver uma senha pronta —
// hoje envia um link de redefinição pro e-mail do próprio login, capturado aqui via um
// `FakeEmailSender` (nunca envia e-mail de verdade).
//
// A antiga rotação de instâncias de app (`freshHttpServer()`) existia só pra contornar o throttler de
// `/auth/login`, que era 5/15min por IP — não é mais necessário: o limite por IP subiu pra 100/15min
// (26/09/2026, ver auth.controller.ts) e a proteção de verdade contra chute de senha passou a ser o
// contador por CONTA dentro de `AuthService.login`, então uma única instância de app com
// `ThrottlerGuard`/`FriendlyThrottlerGuard` sobrescritos (mesmo padrão já usado por
// `access-and-sessions.e2e-spec.ts`/`plans.e2e-spec.ts`) é suficiente e mais simples.
describe('Edição/exclusão/reset de senha de login e bloqueio temporário por tentativas (e2e)', () => {
  let app: INestApplication;
  let fake: FakeEmailSender;
  let prisma: PrismaService;
  let companyId: string;
  let adminToken: string;
  let adminEmail: string;
  let administradorGeralId: string;

  beforeEach(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    fake = new FakeEmailSender();
    app = await bootApp(fake);
    prisma = app.get(PrismaService);

    adminEmail = `users-mgmt-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set(CSRF_HEADER)
      .send(buildRegisterBody({ companyName: 'Users Mgmt Co', email: adminEmail, password: 'senha-de-teste-12345' }))
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = user.companyId;
    await markEmailVerified(prisma, adminEmail);
    // O fundador nasce vinculado ao perfil protegido "Administrador Geral" (todas as permissões) —
    // reaproveitado abaixo pra criar os logins de teste deste arquivo sem precisar de um
    // POST /profiles à parte, mesmo padrão já usado em profiles-shared-permission-guard.e2e-spec.ts.
    administradorGeralId = user.profileId!;
  });

  afterEach(async () => {
    const schemaName = await getTenantSchemaName(prisma, companyId);
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
    await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
    await sys(() => prisma.userToken.deleteMany({ where: { user: { companyId } } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await app.close();
  });

  // Cria um login ADMIN (nasce INVITED) e já aceita o convite com a senha informada, deixando-o
  // ACTIVE e pronto pra logar — mesmo papel que "criar com senha temporária conhecida" cumpria antes
  // desta mudança.
  async function createActiveAdmin(label: string, password: string): Promise<{ userId: string; email: string }> {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
    const createRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email, role: 'ADMIN', profileId: administradorGeralId })
      .expect(201);
    expect(createRes.body.temporaryPassword).toBeUndefined();
    await acceptInvite(app, createRes.body.inviteUrl, password);
    return { userId: createRes.body.user.id, email };
  }

  // O teste que existia aqui ("PATCH /companies/me/users/:id edita os módulos de um login sem
  // recriá-lo") cobria UsersService.update(), removido na Fase 2a (19/09/2026,
  // authorization-profiles-screen/Task 8) — `modules` deixou de ser editável em separado, agora é
  // sempre DERIVADO do Perfil do login via o novo `PATCH /companies/me/users/:id/profile`
  // (ver UsersService.assignProfile), coberto em test/profiles.e2e-spec.ts.

  it('DELETE /companies/me/users/:id exclui um login de verdade (não aparece mais na listagem)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: `delete-me-${Date.now()}@test.com`, role: 'ADMIN', profileId: administradorGeralId })
      .expect(201);
    const userId = createRes.body.user.id;

    await request(app.getHttpServer())
      .delete(`/companies/me/users/${userId}`)
      .set('Authorization', adminToken)
      .expect(204);

    const listRes = await request(app.getHttpServer())
      .get('/companies/me/users')
      .set('Authorization', adminToken)
      .expect(200);
    expect(listRes.body.find((u: { id: string }) => u.id === userId)).toBeUndefined();
  });

  it('DELETE recusa excluir o último ADMIN ativo da empresa', async () => {
    // O fundador (adminToken) é o único ADMIN ativo desta empresa neste ponto do teste.
    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    const res = await request(app.getHttpServer())
      .delete(`/companies/me/users/${founder.id}`)
      .set('Authorization', adminToken)
      .expect(400);
    expect(res.body.message).toMatch(/pelo menos um login ADMIN ativo/i);
  });

  it('PATCH /companies/me/users/:id/reset-password envia um link de redefinição por e-mail (nunca uma senha pronta); o link muda o hash de verdade', async () => {
    const { userId, email } = await createActiveAdmin('reset-pw', 'senha-propria-123');

    // A senha original (definida ao aceitar o convite) funciona antes do reset — prova que o reset
    // muda o hash de verdade (não é um no-op que coincidentemente "funciona" de novo).
    await request(app.getHttpServer()).post('/auth/login').set(CSRF_HEADER).send({ email, password: 'senha-propria-123' }).expect(201);

    const resetRes = await request(app.getHttpServer())
      .patch(`/companies/me/users/${userId}/reset-password`)
      .set('Authorization', adminToken)
      .expect(200);
    expect(resetRes.body.temporaryPassword).toBeUndefined();
    expect(resetRes.body.sent).toBe(true);

    const message = await waitForEmail(fake, email);
    if (!message) throw new Error('e-mail de redefinição não foi capturado pelo FakeEmailSender');
    const token = tokenFromLink(message.text, '/redefinir-senha');

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set(CSRF_HEADER)
      .send({ token, newPassword: 'senha-redefinida-pelo-admin-456' })
      .expect(204);

    // A senha própria que o login tinha escolhido já não é mais válida — reset() muda o hash de
    // verdade, não é um no-op.
    await request(app.getHttpServer()).post('/auth/login').set(CSRF_HEADER).send({ email, password: 'senha-propria-123' }).expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-redefinida-pelo-admin-456' })
      .expect(201);
  });

  it('5 senhas erradas seguidas travam a conta TEMPORARIAMENTE (403 ACCOUNT_TEMPORARILY_LOCKED), mesmo pra senha certa depois', async () => {
    const { email } = await createActiveAdmin('lockout', 'senha-de-verdade-123');

    // As 5 tentativas erradas (a última é a que trava) — todas com a mensagem genérica de sempre,
    // inclusive a 5ª (nunca revela que aquela tentativa específica acabou de travar a conta).
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set(CSRF_HEADER)
        .send({ email, password: 'senha-errada' })
        .expect(401);
    }

    // Diferente do antigo `status: 'LOCKED'` (permanente, só admin destravava): a trava agora é
    // temporária (`User.lockedUntil`), sinalizada por um 403 com `code` específico — nunca mais um
    // 401 genérico, mesmo com a senha certa.
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-de-verdade-123' })
      .expect(403);
    expect(res.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(res.body.message).toMatch(/tente novamente/i);
  });

  it('reset-password (admin) limpa a trava temporária — a senha nova funciona imediatamente', async () => {
    const { userId, email } = await createActiveAdmin('reset-unlocks', 'senha-original-789');

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set(CSRF_HEADER)
        .send({ email, password: 'senha-errada' })
        .expect(401);
    }
    // Confirma a trava antes de seguir — senão o teste provaria pouco.
    const lockedCheck = await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-original-789' })
      .expect(403);
    expect(lockedCheck.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${userId}/reset-password`)
      .set('Authorization', adminToken)
      .expect(200);
    const message = await waitForEmail(fake, email);
    if (!message) throw new Error('e-mail de redefinição não foi capturado pelo FakeEmailSender');
    const token = tokenFromLink(message.text, '/redefinir-senha');

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set(CSRF_HEADER)
      .send({ token, newPassword: 'senha-nova-pos-trava-000' })
      .expect(204);

    // Sem precisar de unblock nenhum: resetPassword() já zera failedLoginAttempts/lockedUntil (ver
    // AuthService.resetPassword) — a senha nova funciona na hora.
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-nova-pos-trava-000' })
      .expect(201);
  });

  it('PATCH .../unblock também limpa a trava temporária — a senha original volta a funcionar sem precisar de reset', async () => {
    const { userId, email } = await createActiveAdmin('unblock-resets', 'senha-original-000');

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set(CSRF_HEADER)
        .send({ email, password: 'senha-errada' })
        .expect(401);
    }
    const lockedCheck = await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-original-000' })
      .expect(403);
    expect(lockedCheck.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${userId}/unblock`)
      .set('Authorization', adminToken)
      .expect(204);

    // unblock() zera failedLoginAttempts/lockedUntil (mesmo efeito de reset-password sobre a trava,
    // mas SEM emitir um token/e-mail novo nem mudar a senha) — a senha ORIGINAL (nunca trocada)
    // volta a funcionar direto.
    await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-original-000' })
      .expect(201);
  });
});
