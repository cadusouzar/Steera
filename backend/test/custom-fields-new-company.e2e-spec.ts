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

describe('Empresa nova nunca herda campos personalizados de outra empresa (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyOldId: string, companyNewId: string;
  let tokenOld: string, tokenNew: string;
  const runId = Date.now();

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) throw new Error('DATABASE_URL must point to a *_test database');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const regOld = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Empresa Já Customizada', email: `cf-old-${runId}@test.com`, password: 'senha-de-teste-12345' }))
      .expect(201);
    tokenOld = `Bearer ${regOld.body.accessToken}`;
    const userOld = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: `cf-old-${runId}@test.com` } }));
    companyOldId = userOld.companyId;

    // Empresa "antiga" cria vários campos personalizados em Clientes antes da empresa nova existir.
    for (const displayName of ['Segmento', 'Código interno', 'Cliente VIP']) {
      await request(app.getHttpServer())
        .post('/custom-fields')
        .set('Authorization', tokenOld)
        .send({ entity: 'client', displayName, type: displayName === 'Cliente VIP' ? 'BOOLEAN' : 'TEXT' })
        .expect(201);
    }
  });

  afterAll(async () => {
    for (const companyId of [companyOldId, companyNewId]) {
      const schemaNameToDrop = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaNameToDrop}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  it('empresa registrada DEPOIS das customizações nasce com zero campos personalizados', async () => {
    const regNew = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Empresa Nova', email: `cf-new-${runId}@test.com`, password: 'senha-de-teste-12345' }))
      .expect(201);
    tokenNew = `Bearer ${regNew.body.accessToken}`;
    const userNew = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: `cf-new-${runId}@test.com` } }));
    companyNewId = userNew.companyId;

    const activeFields = await request(app.getHttpServer())
      .get('/custom-fields/active?entity=client')
      .set('Authorization', tokenNew)
      .expect(200);
    expect(activeFields.body).toEqual([]);
  });

  it('depois de criar seu próprio campo, a empresa nova só tem o seu — a antiga continua com os 3 dela', async () => {
    await request(app.getHttpServer())
      .post('/custom-fields')
      .set('Authorization', tokenNew)
      .send({ entity: 'client', displayName: 'Origem do lead', type: 'TEXT' })
      .expect(201);

    const activeFieldsNew = await request(app.getHttpServer())
      .get('/custom-fields/active?entity=client')
      .set('Authorization', tokenNew)
      .expect(200);
    expect(activeFieldsNew.body).toHaveLength(1);
    expect(activeFieldsNew.body[0].columnName).toBe('custom_origem_do_lead');

    const activeFieldsOld = await request(app.getHttpServer())
      .get('/custom-fields/active?entity=client')
      .set('Authorization', tokenOld)
      .expect(200);
    expect(activeFieldsOld.body).toHaveLength(3);
  });
});
