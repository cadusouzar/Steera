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

/**
 * Concurrent cross-tenant isolation test for the RLS backstop (see the RLS
 * report at .scratchpad/audit-fix-2-rls-report.md for full context).
 *
 * This is deliberately NOT just "register two companies and check each only
 * sees its own data sequentially" — a naive/wrong implementation of the
 * tenant-context-via-set_config(...) mechanism could easily pass a
 * sequential test while still leaking under real concurrency, if it ever
 * used a plain `SET` instead of a transaction-scoped `set_config(..., true)`,
 * or if the AsyncLocalStorage context ever leaked/crossed between requests.
 * Firing a genuine burst of interleaved concurrent requests against a real
 * connection-pooled Postgres client is what actually exercises that hazard.
 */
describe('RLS backstop: concurrent cross-tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyAId: string;
  let companyBId: string;
  let tokenA: string;
  let tokenB: string;

  const runId = Date.now();
  const emailA = `rls-a-${runId}@test.com`;
  const emailB = `rls-b-${runId}@test.com`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      const safeUrl = url ? url.replace(/\/\/[^@/]*@/, '//***:***@') : '(unset)';
      throw new Error(
        'DATABASE_URL must point to a *_test database for e2e tests — refusing to run against ' + safeUrl,
      );
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
      // AntiCsrfHeaderGuard requires this on POST /auth/register — see
      // anti-csrf-header.guard.ts.
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'RLS Isolation Co A', email: emailA, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenA = `Bearer ${registerA.body.accessToken}`;

    const registerB = await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'RLS Isolation Co B', email: emailB, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenB = `Bearer ${registerB.body.accessToken}`;

    const userA = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: emailA } }));
    const userB = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: emailB } }));
    companyAId = userA.companyId;
    companyBId = userB.companyId;

    // Seed each company with a handful of distinctively-named clients, all
    // through the real HTTP API (not a direct Prisma call) so this exercises
    // the exact same request path (interceptor -> tenant context -> Prisma
    // extension -> RLS) that production traffic uses.
    const seedCount = 8;
    await Promise.all([
      ...Array.from({ length: seedCount }, (_, i) =>
        request(server)
          .post('/clients')
          .send({ name: `Cliente RLS-A-${i}`, contact: '(11) 90000-0000' })
          .set('Authorization', tokenA)
          .expect(201),
      ),
      ...Array.from({ length: seedCount }, (_, i) =>
        request(server)
          .post('/clients')
          .send({ name: `Cliente RLS-B-${i}`, contact: '(11) 90000-0001' })
          .set('Authorization', tokenB)
          .expect(201),
      ),
    ]);
  });

  afterAll(async () => {
    await sys(async () => {
      // Task 7 (schema-per-tenant): POST /auth/register now provisions a real physical Postgres
      // schema per company (see AuthService.register) — dropping the Company row below never drops
      // this, since the schema is a separate DDL object, not a relational child of Company. Without
      // this, every run of this suite (it registers TWO companies) would leak two orphaned
      // `tenant_*` schemas into the test database forever.
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "tenant_${companyAId}" CASCADE`);
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "tenant_${companyBId}" CASCADE`);
      await prisma.receivable.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.subscription.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
      await prisma.company.delete({ where: { id: companyAId } });
      await prisma.company.delete({ where: { id: companyBId } });
    });
    await app.close();
  });

  it('never returns company A data to company B or vice versa, under a burst of interleaved concurrent requests', async () => {
    const server = app.getHttpServer();
    const ROUNDS = 15; // >= the 10-20 concurrent interleaved requests the brief asks for

    const requests: Promise<{ company: 'A' | 'B'; names: string[] }>[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      // Alternate A/B so the SAME pooled connections get reused across
      // different tenants back-to-back, mid-burst — exactly the scenario
      // that would surface a connection-pooling leak from a naive
      // `SET`/`set_config(..., false)` implementation instead of the
      // required transaction-scoped `set_config(..., true)`.
      const useA = i % 2 === 0;
      const token = useA ? tokenA : tokenB;
      const company: 'A' | 'B' = useA ? 'A' : 'B';
      requests.push(
        request(server)
          .get('/clients?pageSize=100')
          .set('Authorization', token)
          .expect(200)
          .then((res) => ({
            company,
            names: (res.body.items as Array<{ name: string }>).map((c) => c.name),
          })),
      );
    }

    const results = await Promise.all(requests);

    let checkedA = 0;
    let checkedB = 0;
    for (const { company, names } of results) {
      const foreignPrefix = company === 'A' ? 'Cliente RLS-B-' : 'Cliente RLS-A-';
      const ownPrefix = company === 'A' ? 'Cliente RLS-A-' : 'Cliente RLS-B-';

      // The hard assertion: not a single response for company X ever
      // contains a single row belonging to company Y.
      const leaked = names.filter((n) => n.startsWith(foreignPrefix));
      expect(leaked).toEqual([]);

      // Sanity check that this response saw ITS OWN seeded rows (proves the
      // request actually exercised real data instead of vacuously returning
      // nothing for both companies, which would make the isolation
      // assertion above meaningless).
      expect(names.some((n) => n.startsWith(ownPrefix))).toBe(true);

      if (company === 'A') checkedA++;
      else checkedB++;
    }

    expect(checkedA).toBeGreaterThan(0);
    expect(checkedB).toBeGreaterThan(0);
    expect(checkedA + checkedB).toBe(ROUNDS);
  });

  it('a wrong/nonexistent tenant context fails hard instead of silently returning someone else\'s rows', async () => {
    // Directly exercises the Prisma extension with a bogus companyId — the same mechanism the
    // interceptor uses, just pointed at a company that does not exist. Every real company always
    // has a physical schema now (every legacy pre-schema-per-tenant company was deleted, and the
    // registry no longer supports operating without one), so a bogus companyId has nowhere to
    // route to and the query throws (the schema itself doesn't exist) — a clean, safe failure, never
    // silent data from A or B.
    const { runWithTenant } = await import('../src/prisma/tenant-context');
    await expect(
      runWithTenant('nonexistentcompanyid1234567890', () => prisma.client.findMany({ where: {} })),
    ).rejects.toThrow();
  });

  it('no tenant context at all sees zero rows', async () => {
    const rows = await prisma.client.findMany({ where: {} });
    expect(rows).toEqual([]);
  });
});
