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

      // Rule: an explicit status=ACTIVE filter excludes both (strictly active-only).
      const activeListing = await request(server).get('/clients?status=ACTIVE&pageSize=100').expect(200);
      const activeIds = activeListing.body.items.map((c: { id: string }) => c.id);
      expect(activeIds).not.toContain(clientA.id);
      expect(activeIds).not.toContain(clientB.id);

      // Rule: the "listagem padrão" (excludeTrashed=true, what the frontend's
      // Clientes & Recebimentos screen actually calls) keeps A — inactive but
      // kept in the report, so it must stay reachable/reactivatable — and only
      // excludes B, which is in the trash.
      const operationalListing = await request(server).get('/clients?excludeTrashed=true&pageSize=100').expect(200);
      const operationalIds = operationalListing.body.items.map((c: { id: string }) => c.id);
      expect(operationalIds).toContain(clientA.id);
      expect(operationalIds).not.toContain(clientB.id);

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

  it('client trash: deactivating with includeInRevenueReport=false enters the trash, can be restored, and purges for real after 30 days — while includeInRevenueReport=true never gets purged', async () => {
    const server = app.getHttpServer();

    const trashed = (
      await request(server).post('/clients').send({ name: 'Cliente E2E Lixeira', contact: '(11) 94444-4444' }).expect(201)
    ).body;
    const kept = (
      await request(server).post('/clients').send({ name: 'Cliente E2E Mantido', contact: '(11) 95555-5555' }).expect(201)
    ).body;

    try {
      await request(server).patch(`/clients/${trashed.id}/deactivate`).send({ includeInRevenueReport: false }).expect(200);
      await request(server).patch(`/clients/${kept.id}/deactivate`).send({ includeInRevenueReport: true }).expect(200);

      // Rule: only the "not kept in reports" client shows up in the trash.
      const trashListing = await request(server).get('/clients/trash').expect(200);
      const trashIds = trashListing.body.map((c: { id: string }) => c.id);
      expect(trashIds).toContain(trashed.id);
      expect(trashIds).not.toContain(kept.id);

      // Rule: restoring reactivates and removes it from the trash.
      await request(server).patch(`/clients/${trashed.id}/restore`).expect(200);
      const afterRestore = await request(server).get('/clients/trash').expect(200);
      expect(afterRestore.body.map((c: { id: string }) => c.id)).not.toContain(trashed.id);
      const activeListing = await request(server).get('/clients?status=ACTIVE&pageSize=100').expect(200);
      expect(activeListing.body.items.map((c: { id: string }) => c.id)).toContain(trashed.id);

      // Restoring an already-active client is rejected.
      await request(server).patch(`/clients/${trashed.id}/restore`).expect(409);

      // Give `trashed` a receivable and a subscription while it's still active,
      // so the purge below has real child rows to cascade-delete — otherwise
      // this test would only prove the Client row disappears, never that the
      // FK cascade (onDelete: Cascade on Receivable/Subscription) actually works.
      await request(server)
        .post(`/clients/${trashed.id}/receivables`)
        .send({ description: 'Lançamento antes do purge', amount: 50, dueDate: '2026-01-01' })
        .expect(201);
      await request(server)
        .post(`/clients/${trashed.id}/subscriptions`)
        .send({ description: 'Assinatura antes do purge', amount: 30, dueDay: 10 })
        .expect(201);

      // Put it back in the trash, then simulate 31 days having passed.
      await request(server).patch(`/clients/${trashed.id}/deactivate`).send({ includeInRevenueReport: false }).expect(200);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 31);
      await prisma.client.update({ where: { id: trashed.id }, data: { deactivatedAt: cutoff } });
      await prisma.client.update({ where: { id: kept.id }, data: { deactivatedAt: cutoff } });

      // Opening the trash triggers the defensive purge: `trashed` (flag=false,
      // past the cutoff) is really gone; `kept` (flag=true) survives untouched
      // even though its deactivatedAt is just as old.
      await request(server).get('/clients/trash').expect(200);
      await request(server).get(`/clients/${trashed.id}`).expect(404);
      await request(server).get(`/clients/${kept.id}`).expect(200);

      // Rule: the purge really cascades — trashed's receivable and subscription
      // are gone too, not just the Client row.
      const remainingReceivables = await prisma.receivable.findMany({ where: { clientId: trashed.id } });
      expect(remainingReceivables).toEqual([]);
      const remainingSubscriptions = await prisma.subscription.findMany({ where: { clientId: trashed.id } });
      expect(remainingSubscriptions).toEqual([]);
    } finally {
      await prisma.receivable.deleteMany({ where: { clientId: { in: [trashed.id, kept.id] } } });
      await prisma.client.deleteMany({ where: { id: { in: [trashed.id, kept.id] } } });
    }
  });
});
