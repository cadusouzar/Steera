import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('QuickFlow backend (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // These tests create and delete real rows. Refuse to touch anything but the
    // dedicated test database, so a stray `npm run test:e2e` can't hit dev data.
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      // Redact credentials before echoing the URL into test output.
      const safeUrl = url ? url.replace(/\/\/[^@/]*@/, '//***:***@') : '(unset)';
      throw new Error(
        'DATABASE_URL must point to a *_test database for e2e tests — refusing to run against ' +
          safeUrl,
      );
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a client, a receivable, marks it as paid, and reflects it in the report', async () => {
    const server = app.getHttpServer();

    const clientRes = await request(server)
      .post('/clients')
      .send({ name: 'Cliente E2E', contact: '(11) 90000-0000' })
      .expect(201);

    const clientId = clientRes.body.id;

    try {
      const beforeRes = await request(server).get('/reports/financial-summary').expect(200);
      const totalPaidBefore = beforeRes.body.totalPaid;

      const receivableRes = await request(server)
        .post(`/clients/${clientId}/receivables`)
        .send({ description: 'Mensalidade', amount: 100, dueDate: '2026-01-01' })
        .expect(201);

      await request(server).patch(`/receivables/${receivableRes.body.id}/pay`).expect(200);

      const listRes = await request(server).get(`/clients/${clientId}/receivables`).expect(200);
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].derivedStatus).toBe('paid');

      const reportRes = await request(server).get('/reports/financial-summary').expect(200);
      expect(reportRes.body.totalPaid).toBe(totalPaidBefore + 100);

      // `sort` is a spec'd query param; with forbidNonWhitelisted it used to 400.
      const sortedRes = await request(server)
        .get(`/clients/${clientId}/receivables?sort=dueDate_asc`)
        .expect(200);
      expect(sortedRes.body.items).toHaveLength(1);

      const clientDetailRes = await request(server).get(`/clients/${clientId}`).expect(200);
      expect(clientDetailRes.body.totalPaid).toBe(100);
      expect(clientDetailRes.body.totalPending).toBe(0);
      expect(clientDetailRes.body.totalOverdue).toBe(0);
    } finally {
      await prisma.receivable.deleteMany({ where: { clientId } });
      await prisma.client.delete({ where: { id: clientId } });
    }
  });

  it('returns 404 when creating a receivable for a client that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/clients/does-not-exist/receivables')
      .send({ description: 'x', amount: 10, dueDate: '2026-01-01' })
      .expect(404);
  });

  it('deactivating a client is a logical delete: hides it from the default listing, keeps its receivables, and honors includeInRevenueReport independently per client', async () => {
    const server = app.getHttpServer();

    const clientA = (
      await request(server)
        .post('/clients')
        .send({ name: 'Cliente E2E Manter Relatorio', contact: '(11) 91111-1111' })
        .expect(201)
    ).body;
    const clientB = (
      await request(server)
        .post('/clients')
        .send({ name: 'Cliente E2E Remover Relatorio', contact: '(11) 92222-2222' })
        .expect(201)
    ).body;

    try {
      // Captured before either client has any receivable, so it's the correct
      // baseline for "only A's 150 should be added, B's 75 never counted".
      const baselineReport = (await request(server).get('/reports/financial-summary').expect(200)).body;

      const recA = (
        await request(server)
          .post(`/clients/${clientA.id}/receivables`)
          .send({ description: 'A', amount: 150, dueDate: '2026-01-01' })
          .expect(201)
      ).body;
      await request(server).patch(`/receivables/${recA.id}/pay`).expect(200);

      const recB = (
        await request(server)
          .post(`/clients/${clientB.id}/receivables`)
          .send({ description: 'B', amount: 75, dueDate: '2026-01-01' })
          .expect(201)
      ).body;
      await request(server).patch(`/receivables/${recB.id}/pay`).expect(200);

      // A keeps its numbers in the report after deactivation; B does not.
      await request(server).patch(`/clients/${clientA.id}/deactivate`).send({ includeInRevenueReport: true }).expect(200);
      await request(server).patch(`/clients/${clientB.id}/deactivate`).send({ includeInRevenueReport: false }).expect(200);

      // Rule: the default (active-only) listing excludes both now.
      const activeListing = await request(server).get('/clients?status=ACTIVE&pageSize=100').expect(200);
      const activeIds = activeListing.body.items.map((c: { id: string }) => c.id);
      expect(activeIds).not.toContain(clientA.id);
      expect(activeIds).not.toContain(clientB.id);

      // Rule: historical receivables are untouched — still there, still paid.
      const recAAfter = await request(server).get(`/clients/${clientA.id}/receivables`).expect(200);
      expect(recAAfter.body.items).toHaveLength(1);
      expect(recAAfter.body.items[0].derivedStatus).toBe('paid');

      // Rule: the report follows includeInRevenueReport, not status — A's paid
      // amount is still counted (inactive but flagged in), B's is not.
      const afterReport = (await request(server).get('/reports/financial-summary').expect(200)).body;
      expect(afterReport.totalPaid).toBe(baselineReport.totalPaid + 150);

      // Rule: an inactive client cannot receive new lançamentos.
      await request(server)
        .post(`/clients/${clientA.id}/receivables`)
        .send({ description: 'novo', amount: 10, dueDate: '2026-02-01' })
        .expect(400);

      // Rule: deactivating an already-inactive client is rejected.
      await request(server)
        .patch(`/clients/${clientA.id}/deactivate`)
        .send({ includeInRevenueReport: true })
        .expect(409);

      // Rule: the flag is required (validated before the business-logic check
      // above even runs, so it applies regardless of clientB's state here).
      await request(server).patch(`/clients/${clientB.id}/deactivate`).send({}).expect(400);
    } finally {
      await prisma.receivable.deleteMany({ where: { clientId: { in: [clientA.id, clientB.id] } } });
      await prisma.client.deleteMany({ where: { id: { in: [clientA.id, clientB.id] } } });
    }
  });

  it('returns 404 when deactivating a client that does not exist', async () => {
    await request(app.getHttpServer())
      .patch('/clients/does-not-exist/deactivate')
      .send({ includeInRevenueReport: true })
      .expect(404);
  });

  it('rejects status in PATCH /clients/:id — lifecycle changes only go through /deactivate and /restore', async () => {
    const clientRes = await request(app.getHttpServer())
      .post('/clients')
      .send({ name: 'Cliente E2E Status Bloqueado', contact: '(11) 93333-3333' })
      .expect(201);

    try {
      await request(app.getHttpServer())
        .patch(`/clients/${clientRes.body.id}`)
        .send({ status: 'INACTIVE' })
        .expect(400);
    } finally {
      await prisma.client.delete({ where: { id: clientRes.body.id } });
    }
  });
});
