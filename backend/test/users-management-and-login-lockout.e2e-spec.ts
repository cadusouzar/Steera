import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';

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

// Cobre as features novas de 17/09/2026 (edição/exclusão/reset de senha de um login, e o
// bloqueio persistente após 5 tentativas de senha erradas) contra Postgres real — os mesmos
// call sites de UsersService.update/remove/resetPassword usam o padrão de transação central
// manual (ver o comentário completo em AuthService.changePassword), que testes unitários mockados
// não conseguem pegar se a rota real quebrar.
//
// Boot de app "sob demanda" (bootApp(), chamado quantas vezes cada teste precisar, nunca um único
// app fixo por describe/beforeAll) — de propósito: o ThrottlerGuard de /auth/login (5/15min por
// IP, mais 5/15min por e-mail) usa armazenamento em memória POR INSTÂNCIA de app. Os testes de
// bloqueio abaixo precisam enviar mais de 5 requisições de login no total (5 erradas pra travar +
// pelo menos 1 depois pra confirmar o novo comportamento) — como o estado do LOCKOUT em si mora no
// banco (persiste entre instâncias de app), basta trocar de instância de app depois das 5
// tentativas erradas pra continuar testando com um contador de throttle limpo, sem nunca esbarrar
// no 429 do throttler no meio do teste.
describe('Edição/exclusão/reset de senha de login e bloqueio por tentativas (e2e)', () => {
  let apps: INestApplication[];
  let prisma: PrismaService;
  let companyId: string;
  let adminToken: string;
  let adminEmail: string;

  beforeEach(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    apps = [await bootApp()];
    prisma = apps[0].get(PrismaService);

    adminEmail = `users-mgmt-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`;
    const registerRes = await request(apps[0].getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Users Mgmt Co', email: adminEmail, password: 'senha-de-teste-12345' })
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = user.companyId;
  });

  afterEach(async () => {
    const schemaName = `tenant_${companyId}`;
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
    await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await Promise.all(apps.map((a) => a.close()));
  });

  // Abre uma instância de app NOVA (throttler zerado) e a registra pra ser fechada no afterEach.
  async function freshHttpServer() {
    const app = await bootApp();
    apps.push(app);
    return app.getHttpServer();
  }

  it('PATCH /companies/me/users/:id edita os módulos de um login sem recriá-lo', async () => {
    const createRes = await request(apps[0].getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: `edit-modules-${Date.now()}@test.com`, role: 'ADMIN', modules: ['DASHBOARD'] })
      .expect(201);
    const userId = createRes.body.user.id;

    const editRes = await request(apps[0].getHttpServer())
      .patch(`/companies/me/users/${userId}`)
      .set('Authorization', adminToken)
      .send({ modules: ['DASHBOARD', 'PONTO_REGISTRO'] })
      .expect(200);
    expect(editRes.body.modules.sort()).toEqual(['DASHBOARD', 'PONTO_REGISTRO'].sort());

    const listRes = await request(apps[0].getHttpServer())
      .get('/companies/me/users')
      .set('Authorization', adminToken)
      .expect(200);
    const persisted = listRes.body.find((u: { id: string }) => u.id === userId);
    expect(persisted.modules.sort()).toEqual(['DASHBOARD', 'PONTO_REGISTRO'].sort());
  });

  it('DELETE /companies/me/users/:id exclui um login de verdade (não aparece mais na listagem)', async () => {
    const createRes = await request(apps[0].getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: `delete-me-${Date.now()}@test.com`, role: 'ADMIN', modules: ['DASHBOARD'] })
      .expect(201);
    const userId = createRes.body.user.id;

    await request(apps[0].getHttpServer())
      .delete(`/companies/me/users/${userId}`)
      .set('Authorization', adminToken)
      .expect(204);

    const listRes = await request(apps[0].getHttpServer())
      .get('/companies/me/users')
      .set('Authorization', adminToken)
      .expect(200);
    expect(listRes.body.find((u: { id: string }) => u.id === userId)).toBeUndefined();
  });

  it('DELETE recusa excluir o último ADMIN ativo da empresa', async () => {
    // O fundador (adminToken) é o único ADMIN ativo desta empresa neste ponto do teste.
    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    const res = await request(apps[0].getHttpServer())
      .delete(`/companies/me/users/${founder.id}`)
      .set('Authorization', adminToken)
      .expect(400);
    expect(res.body.message).toMatch(/pelo menos um login ADMIN ativo/i);
  });

  it('PATCH /companies/me/users/:id/reset-password gera uma senha nova, reativa o login e permite logar com ela', async () => {
    const empEmail = `reset-pw-${Date.now()}@test.com`;
    const createRes = await request(apps[0].getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: empEmail, role: 'ADMIN', modules: ['DASHBOARD'] })
      .expect(201);
    const userId = createRes.body.user.id;

    // A senha temporária de create() é sempre o mesmo literal fixo ('Mudar@123') — pra provar que
    // reset-password troca o hash de verdade (não é um no-op que coincidentemente "funciona" por
    // gerar a mesma senha de novo), o login primeiro troca pra uma senha PRÓPRIA antes do reset.
    const loginRes = await request(apps[0].getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: empEmail, password: createRes.body.temporaryPassword })
      .expect(201);
    await request(apps[0].getHttpServer())
      .patch('/auth/me/password')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ currentPassword: createRes.body.temporaryPassword, newPassword: 'senha-propria-123' })
      .expect(200);

    const resetRes = await request(apps[0].getHttpServer())
      .patch(`/companies/me/users/${userId}/reset-password`)
      .set('Authorization', adminToken)
      .expect(200);
    const newTempPassword = resetRes.body.temporaryPassword;
    expect(newTempPassword).toEqual(expect.any(String));

    // A senha própria que o login tinha escolhido já não é mais válida — reset() muda o hash de
    // verdade, não é um no-op.
    await request(apps[0].getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: empEmail, password: 'senha-propria-123' })
      .expect(401);

    await request(apps[0].getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: empEmail, password: newTempPassword })
      .expect(201);
  });

  it('5 senhas erradas seguidas travam a conta (LOCKED) com mensagem própria, mesmo pra senha certa depois', async () => {
    const email = `lockout-${Date.now()}@test.com`;
    const createRes = await request(apps[0].getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email, role: 'ADMIN', modules: ['DASHBOARD'] })
      .expect(201);

    // As 5 tentativas erradas (a última é a que trava) — todas com a mensagem genérica de sempre,
    // inclusive a 5ª (nunca revela que aquela tentativa específica acabou de travar a conta).
    for (let i = 0; i < 5; i += 1) {
      await request(apps[0].getHttpServer())
        .post('/auth/login')
        .set('x-requested-with', 'XMLHttpRequest')
        .send({ email, password: 'senha-errada' })
        .expect(401);
    }

    // Nova instância de app (throttler limpo) — o estado LOCKED em si já está persistido no banco.
    const freshServer = await freshHttpServer();
    const res = await request(freshServer)
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email, password: createRes.body.temporaryPassword })
      .expect(403);
    expect(res.body.message).toMatch(/redefinir sua senha/i);
  });

  it('reset-password reativa um login LOCKED e a nova senha funciona imediatamente', async () => {
    const email = `reset-unlocks-${Date.now()}@test.com`;
    const createRes = await request(apps[0].getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email, role: 'ADMIN', modules: ['DASHBOARD'] })
      .expect(201);
    const userId = createRes.body.user.id;

    for (let i = 0; i < 5; i += 1) {
      await request(apps[0].getHttpServer())
        .post('/auth/login')
        .set('x-requested-with', 'XMLHttpRequest')
        .send({ email, password: 'senha-errada' })
        .expect(401);
    }

    const resetRes = await request(apps[0].getHttpServer())
      .patch(`/companies/me/users/${userId}/reset-password`)
      .set('Authorization', adminToken)
      .expect(200);

    const freshServer = await freshHttpServer();
    await request(freshServer)
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email, password: resetRes.body.temporaryPassword })
      .expect(201);
  });

  it('unblock desbloqueia e zera o contador — a conta volta a aceitar a senha original', async () => {
    const email = `unblock-resets-${Date.now()}@test.com`;
    const createRes = await request(apps[0].getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email, role: 'ADMIN', modules: ['DASHBOARD'] })
      .expect(201);
    const userId = createRes.body.user.id;

    for (let i = 0; i < 5; i += 1) {
      await request(apps[0].getHttpServer())
        .post('/auth/login')
        .set('x-requested-with', 'XMLHttpRequest')
        .send({ email, password: 'senha-errada' })
        .expect(401);
    }

    await request(apps[0].getHttpServer())
      .patch(`/companies/me/users/${userId}/unblock`)
      .set('Authorization', adminToken)
      .expect(204);

    const freshServer = await freshHttpServer();
    await request(freshServer)
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email, password: createRes.body.temporaryPassword })
      .expect(201);
  });
});
