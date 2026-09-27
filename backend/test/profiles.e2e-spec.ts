import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

describe('Profiles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let accessToken: string;

  const runId = Date.now();
  const adminEmail = `profiles-e2e-admin-${runId}@test.com`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Profiles E2E Co', email: adminEmail, password: 'senha-de-teste-12345' }))
      .expect(201);
    accessToken = res.body.accessToken;
    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = user.companyId;
    await markEmailVerified(prisma, adminEmail);
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId } }));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  it('GET /profiles/catalog devolve as 20 permissões (assinatura.gerenciar desde 27/09/2026), sem exigir empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/profiles/catalog')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.length).toBe(20);
    expect(res.body.some((p: { code: string }) => p.code === 'usuarios.gerenciar')).toBe(true);
  });

  it('cria, edita, e bloqueia a exclusão de um perfil em uso', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/profiles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Financeiro', grants: [{ permissionCode: 'financas.lancamentos.ver', scope: 'EMPRESA' }] })
      .expect(201);
    const profileId = createRes.body.id;
    expect(createRes.body.userCount).toBe(0);

    await request(app.getHttpServer())
      .patch(`/profiles/${profileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Financeiro Ampliado', grants: [{ permissionCode: 'financas.lancamentos.gerenciar', scope: 'EMPRESA' }] })
      .expect(200);

    const listRes = await request(app.getHttpServer())
      .get('/profiles')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(listRes.body.find((p: { id: string }) => p.id === profileId)?.name).toBe('Financeiro Ampliado');

    // Segundo ADMIN mantém "Administrador Geral" (com usuarios.gerenciar) — sem isso, reatribuir o
    // FUNDADOR (único login da empresa até aqui) pra um perfil sem essa permissão dispararia
    // corretamente a trava de "último detentor" que PATCH .../profile aplica (Task 8), o que
    // quebraria o propósito deste teste (validar a reatribuição em si, não a trava).
    const adminProfile = listRes.body.find((p: { name: string }) => p.name === 'Administrador Geral');
    const secondAdminRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: `profiles-e2e-admin2-${runId}@test.com`, role: 'ADMIN', profileId: adminProfile.id })
      .expect(201);
    // "Acesso e sessões" (26/09/2026): login criado por um admin nasce INVITED, e a trava de
    // "último detentor" só conta login ACTIVE — sem aceitar o convite, este segundo admin não
    // contaria como "ainda detentor", derrubando o propósito do teste (comentário acima).
    await acceptInvite(app, secondAdminRes.body.inviteUrl, 'senha-segundo-admin-123');

    // Fundador tenta atribuir-se a este perfil pra testar o bloqueio de exclusão em uso.
    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    await request(app.getHttpServer())
      .patch(`/companies/me/users/${founder.id}/profile`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ profileId })
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/profiles/${profileId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('perfil "Administrador Geral" não pode ser editado nem excluído', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/profiles')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const adminProfile = listRes.body.find((p: { name: string }) => p.name === 'Administrador Geral');
    expect(adminProfile.isProtected).toBe(true);

    await request(app.getHttpServer())
      .patch(`/profiles/${adminProfile.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Hackeado', grants: [] })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/profiles/${adminProfile.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });
});
