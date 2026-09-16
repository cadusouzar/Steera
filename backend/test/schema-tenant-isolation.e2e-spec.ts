import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { assertRowAbsentFromPublicSchema, assertRowExistsInTenantSchema, selectBypassingRls } from './tenant-physical-read.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

describe('Isolamento físico por schema — cross-tenant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyAId: string;
  let companyBId: string;
  let tokenA: string;
  let tokenB: string;
  let clientBId: string;

  const runId = Date.now();
  const emailA = `schema-a-${runId}@test.com`;
  const emailB = `schema-b-${runId}@test.com`;

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

    const server = app.getHttpServer();

    const registerA = await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Schema Isolation Co A', email: emailA, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenA = `Bearer ${registerA.body.accessToken}`;

    const registerB = await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Schema Isolation Co B', email: emailB, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenB = `Bearer ${registerB.body.accessToken}`;

    const userA = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: emailA } }));
    const userB = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: emailB } }));
    companyAId = userA.companyId;
    companyBId = userB.companyId;

    await request(server)
      .post('/clients')
      .send({ name: 'Cliente João (A)', contact: '(11) 90000-0000' })
      .set('Authorization', tokenA)
      .expect(201);

    const createB = await request(server)
      .post('/clients')
      .send({ name: 'Cliente Maria (B)', contact: '(11) 90000-0001' })
      .set('Authorization', tokenB)
      .expect(201);
    clientBId = createB.body.id;
  });

  afterAll(async () => {
    for (const companyId of [companyAId, companyBId]) {
      const schemaName = `tenant_${companyId}`;
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  it('cada empresa tem um schema PostgreSQL físico distinto', async () => {
    const schemas = await sys(() =>
      prisma.$queryRawUnsafe<{ schema_name: string }[]>(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('tenant_${companyAId}', 'tenant_${companyBId}')`,
      ),
    );
    expect(schemas.length).toBe(2);
  });

  it('a listagem de clientes da Empresa A nunca inclui um cliente da Empresa B', async () => {
    const res = await request(app.getHttpServer())
      .get('/clients?pageSize=100')
      .set('Authorization', tokenA)
      .expect(200);
    const names = (res.body.items as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain('Cliente João (A)');
    expect(names).not.toContain('Cliente Maria (B)');
  });

  it('tentativa deliberada de acessar um cliente da Empresa B pelo id, autenticado como Empresa A, retorna 404', async () => {
    await request(app.getHttpServer())
      .get(`/clients/${clientBId}`)
      .set('Authorization', tokenA)
      .expect(404);
  });

  it('o Cliente criado no beforeAll está fisicamente dentro do schema da Empresa A, nunca em public', async () => {
    const [client] = await selectBypassingRls<{ id: string }[]>(
      prisma,
      `SELECT id FROM "tenant_${companyAId}"."Client" WHERE name = 'Cliente João (A)'`,
    );
    await assertRowExistsInTenantSchema(prisma, companyAId, 'Client', { id: client.id });
    await assertRowAbsentFromPublicSchema(prisma, 'Client', { id: client.id });
  });

  it('um Funcionário criado pela API da Empresa A está fisicamente dentro do schema dela', async () => {
    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', tokenA)
      .send({ name: 'Cargo Físico', department: 'Teste' })
      .expect(201);

    const empRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', tokenA)
      .send({
        fullName: 'Funcionário Físico',
        cpf: '00000000000',
        roleId: roleRes.body.id,
        contractType: 'CLT',
        admissionDate: '2026-01-01',
        department: 'Operações',
        baseValue: 3000,
        paymentDueDay: 5,
      })
      .expect(201);

    await assertRowExistsInTenantSchema(prisma, companyAId, 'Employee', { id: empRes.body.id });
    await assertRowAbsentFromPublicSchema(prisma, 'Employee', { id: empRes.body.id });
  });
});
