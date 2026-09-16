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

function selectBypassingRls<T>(prisma: PrismaService, sql: string): Promise<T> {
  return sys(async () => {
    const results = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`,
      prisma.$queryRawUnsafe<T>(sql),
    ]);
    return results[1] as T;
  });
}

// Achado na revisão final do routing fix: toda empresa cadastrada ANTES da Fase 1 do
// schema-per-tenant nunca teve `tenant_<companyId>` criado — a Fase 1 sempre foi aditiva de
// propósito (nenhuma empresa/dado já existente seria tocada). Verificado ao vivo, contra a
// database de dev real, que sem o fix desta suíte toda query de tenant dessas empresas quebrava
// com "table does not exist" (P2021). Este teste simula uma empresa legada de verdade: registra
// normalmente (o que cria um schema físico) e então DROPA esse schema — reproduzindo exatamente o
// estado real de qualquer empresa cadastrada antes desta correção — e confirma que o app continua
// funcionando integralmente pra ela, com o dado caindo em `public` (o modelo compartilhado de
// sempre), exatamente como acontecia antes de qualquer trabalho de schema-per-tenant.
describe('Empresa legada, sem schema físico — continua funcionando via o modelo compartilhado (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let token: string;

  const runId = Date.now();
  const email = `legacy-company-${runId}@test.com`;

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
      .send({ companyName: 'Legacy Co (schema simulado ausente)', email, password: 'senha-de-teste-12345' })
      .expect(201);
    token = `Bearer ${registerRes.body.accessToken}`;

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    companyId = user.companyId;

    // Simula uma empresa registrada ANTES da Fase 1: dropa o schema físico que o registro acabou
    // de criar, deixando exatamente o estado real de uma empresa legada — Company/User existem,
    // tenant_<id> não.
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "tenant_${companyId}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
  });

  afterAll(async () => {
    await sys(() => prisma.receivable.deleteMany({ where: { companyId } }));
    await sys(() => prisma.client.deleteMany({ where: { companyId } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await app.close();
  });

  it('a empresa realmente não tem schema físico (confirma a simulação antes de testar o fix)', async () => {
    const schemas = await selectBypassingRls<{ schema_name: string }[]>(
      prisma,
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_${companyId}'`,
    );
    expect(schemas).toHaveLength(0);
  });

  it('POST /clients funciona normalmente, e o Cliente cai em public."Client" (nunca tenta rotear pro schema inexistente)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Empresa Legada', contact: '(11) 90000-0000' })
      .expect(201);
    const clientId = createRes.body.id;

    const rowsInPublic = await selectBypassingRls<{ id: string }[]>(
      prisma,
      `SELECT id FROM public."Client" WHERE id = '${clientId}'`,
    );
    expect(rowsInPublic).toHaveLength(1);
  });

  it('GET /clients lista o Cliente normalmente', async () => {
    const res = await request(app.getHttpServer())
      .get('/clients?pageSize=100')
      .set('Authorization', token)
      .expect(200);
    const names = (res.body.items as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain('Cliente Empresa Legada');
  });

  it('PATCH /clients/:id/deactivate (forma interativa, Task 4) também funciona pra empresa legada', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Legado Pra Desativar', contact: '(11) 90000-0001' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/clients/${createRes.body.id}/deactivate`)
      .set('Authorization', token)
      .send({ includeInRevenueReport: true })
      .expect(200);

    const [row] = await selectBypassingRls<{ status: string }[]>(
      prisma,
      `SELECT status FROM public."Client" WHERE id = '${createRes.body.id}'`,
    );
    expect(row.status).toBe('INACTIVE');
  });
});
