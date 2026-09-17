import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { selectBypassingRls } from './tenant-physical-read.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

describe('Campos personalizados: isolamento entre empresas em Clientes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyAId: string, companyBId: string;
  let tokenA: string, tokenB: string;

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

    const regA = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Custom Fields Co A', email: `cf-a-${runId}@test.com`, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenA = `Bearer ${regA.body.accessToken}`;

    const regB = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Custom Fields Co B', email: `cf-b-${runId}@test.com`, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenB = `Bearer ${regB.body.accessToken}`;

    const userA = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: `cf-a-${runId}@test.com` } }));
    const userB = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: `cf-b-${runId}@test.com` } }));
    companyAId = userA.companyId;
    companyBId = userB.companyId;
  });

  afterAll(async () => {
    for (const companyId of [companyAId, companyBId]) {
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "tenant_${companyId}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  it('a coluna criada pela Empresa A nunca existe fisicamente no schema da Empresa B, e vice-versa', async () => {
    await request(app.getHttpServer())
      .post('/custom-fields')
      .set('Authorization', tokenA)
      .send({ entity: 'client', displayName: 'Segmento', type: 'TEXT' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/custom-fields')
      .set('Authorization', tokenB)
      .send({ entity: 'client', displayName: 'Região', type: 'TEXT' })
      .expect(201);

    const schemaA = `tenant_${companyAId}`;
    const schemaB = `tenant_${companyBId}`;

    const colsInA = await selectBypassingRls<{ column_name: string }[]>(
      prisma,
      `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schemaA}' AND table_name = 'Client' AND column_name LIKE 'custom_%'`,
    );
    expect(colsInA.map((c) => c.column_name)).toEqual(['custom_segmento']);

    const colsInB = await selectBypassingRls<{ column_name: string }[]>(
      prisma,
      `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schemaB}' AND table_name = 'Client' AND column_name LIKE 'custom_%'`,
    );
    expect(colsInB.map((c) => c.column_name)).toEqual(['custom_regiao']);
  });

  it('a Empresa A nunca vê o campo/valor da Empresa B pela API, e vice-versa', async () => {
    const createA = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', tokenA)
      .send({ name: 'Cliente A', contact: '(11) 90000-0000', customFields: { custom_segmento: 'Enterprise' } })
      .expect(201);
    expect(createA.body.customFields).toEqual({ custom_segmento: 'Enterprise' });

    const createB = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', tokenB)
      .send({ name: 'Cliente B', contact: '(11) 90000-0001', customFields: { custom_regiao: 'Sul' } })
      .expect(201);
    expect(createB.body.customFields).toEqual({ custom_regiao: 'Sul' });

    const activeFieldsA = await request(app.getHttpServer())
      .get('/custom-fields/active?entity=client')
      .set('Authorization', tokenA)
      .expect(200);
    expect(activeFieldsA.body.map((f: { columnName: string }) => f.columnName)).toEqual(['custom_segmento']);

    const activeFieldsB = await request(app.getHttpServer())
      .get('/custom-fields/active?entity=client')
      .set('Authorization', tokenB)
      .expect(200);
    expect(activeFieldsB.body.map((f: { columnName: string }) => f.columnName)).toEqual(['custom_regiao']);
  });

  it('uma tentativa de gravar um campo desconhecido é rejeitada com 400', async () => {
    await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', tokenA)
      .send({ name: 'Cliente Inválido', contact: '(11) 90000-0002', customFields: { custom_regiao: 'Sul' } })
      .expect(400);
  });
});
