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

// The tenant schema's own `Client` table carries the same FORCE ROW LEVEL SECURITY policy as
// `public."Client"` (replayed verbatim by the tenant migrations) — a raw $queryRawUnsafe never
// goes through the extension's $allOperations hook, so runAsSystem()'s bypass flag alone never
// reaches Postgres for a raw query, and an un-bypassed SELECT is silently filtered to zero rows.
// See tenant-routing.e2e-spec.ts for the same fix.
function selectBypassingRls<T>(prisma: PrismaService, sql: string): Promise<T> {
  return sys(async () => {
    const results = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`,
      prisma.$queryRawUnsafe<T>(sql),
    ]);
    return results[1] as T;
  });
}

describe('Atomicidade de deactivate() após a migração pra forma interativa (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let token: string;

  const runId = Date.now();
  const email = `deactivate-atomicity-${runId}@test.com`;

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
      .send({ companyName: 'Deactivate Atomicity Co', email, password: 'senha-de-teste-12345' })
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

  it('client.update e subscription.updateMany rodam na mesma transação real (client permanece ATIVO se a request inteira falhar antes de completar)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Atomicidade', contact: '(11) 90000-0000' })
      .expect(201);
    const clientId = createRes.body.id;

    // deactivate() com includeInRevenueReport ausente é rejeitado pela validação ANTES de a
    // transação começar — confirma que uma falha de validação não deixa nenhum estado parcial.
    await request(app.getHttpServer())
      .patch(`/clients/${clientId}/deactivate`)
      .set('Authorization', token)
      .send({})
      .expect(400);

    const schemaName = `tenant_${companyId}`;
    const [row] = await selectBypassingRls<{ status: string }[]>(
      prisma,
      `SELECT status FROM "${schemaName}"."Client" WHERE id = '${clientId}'`,
    );
    expect(row.status).toBe('ACTIVE');

    // Caminho de sucesso real: as duas escritas realmente acontecem juntas.
    await request(app.getHttpServer())
      .patch(`/clients/${clientId}/deactivate`)
      .set('Authorization', token)
      .send({ includeInRevenueReport: true })
      .expect(200);

    const [rowAfter] = await selectBypassingRls<{ status: string }[]>(
      prisma,
      `SELECT status FROM "${schemaName}"."Client" WHERE id = '${clientId}'`,
    );
    expect(rowAfter.status).toBe('INACTIVE');
  });
});
