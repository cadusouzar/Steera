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
});
