import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

describe('Núcleo de autorização — Permission/Profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;

  const runId = Date.now();
  const adminEmail = `authz-core-admin-${runId}@test.com`;

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

  it('register() cria o perfil Administrador Geral e o token traz as permissões', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Authz Core Co', email: adminEmail, password: 'senha-de-teste-12345' }))
      .expect(201);

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = user.companyId;
    expect(user.profileId).not.toBeNull();

    const profile = await sys(() => prisma.profile.findUniqueOrThrow({ where: { id: user.profileId! } }));
    expect(profile.name).toBe('Administrador Geral');
    expect(profile.isProtected).toBe(true);

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(meRes.body.email).toBe(adminEmail);
    // Regressão-alvo: register()/login()/refresh() já voltaram a expor `permissions: {}` (vazio)
    // silenciosamente uma vez, por falta de bypass de RLS ao ler as permissões — corrigido antes
    // desta task. GET /auth/me hoje devolve `permissions` real (`toPublicUser` inclui o campo,
    // `getProfile()` o repassa sem filtrar) — a asserção abaixo falharia de volta se esse bug
    // reaparecesse, checando não só que o objeto não é vazio mas que contém um código de permissão
    // específico do catálogo (`usuarios.gerenciar`, sempre concedido ao perfil Administrador Geral
    // do fundador com escopo EMPRESA) com o escopo esperado.
    expect(Object.keys(meRes.body.permissions ?? {}).length).toBeGreaterThan(0);
    expect(meRes.body.permissions['usuarios.gerenciar']).toBe('EMPRESA');
  });
});
