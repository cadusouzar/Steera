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

describe('Roteamento físico real — dado criado pela API cai no schema do tenant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let token: string;

  const runId = Date.now();
  const email = `routing-fix-${runId}@test.com`;

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

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Routing Fix Co', email, password: 'senha-de-teste-12345' })
      .expect(201);
    token = `Bearer ${registerRes.body.accessToken}`;

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    companyId = user.companyId;
  });

  afterAll(async () => {
    const schemaName = `tenant_${companyId}`;
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await app.close();
  });

  it('um Cliente criado via POST /clients existe fisicamente em tenant_<id>."Client", nunca em public."Client"', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Roteamento Real', contact: '(11) 90000-0000' })
      .expect(201);
    const clientId = createRes.body.id;

    const schemaName = `tenant_${companyId}`;
    const rowsInTenantSchema = await selectBypassingRls<{ id: string }[]>(
      prisma,
      `SELECT id FROM "${schemaName}"."Client" WHERE id = '${clientId}'`,
    );
    expect(rowsInTenantSchema).toHaveLength(1);

    const rowsInPublicSchema = await selectBypassingRls<{ id: string }[]>(
      prisma,
      `SELECT id FROM public."Client" WHERE id = '${clientId}'`,
    );
    expect(rowsInPublicSchema).toHaveLength(0);
  });

  it('GET /clients (via API normal) lista o Cliente corretamente, provando que a leitura também é roteada certo', async () => {
    const res = await request(app.getHttpServer())
      .get('/clients?pageSize=100')
      .set('Authorization', token)
      .expect(200);
    const names = (res.body.items as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain('Cliente Roteamento Real');
  });
});
