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

    const receivableRes = await request(server)
      .post(`/clients/${clientId}/receivables`)
      .send({ description: 'Mensalidade', amount: 100, dueDate: '2026-01-01' })
      .expect(201);

    await request(server).patch(`/receivables/${receivableRes.body.id}/pay`).expect(200);

    const listRes = await request(server).get(`/clients/${clientId}/receivables`).expect(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].derivedStatus).toBe('paid');

    const reportRes = await request(server).get('/reports/financial-summary').expect(200);
    expect(reportRes.body.totalPaid).toBeGreaterThanOrEqual(100);

    await prisma.receivable.deleteMany({ where: { clientId } });
    await prisma.client.delete({ where: { id: clientId } });
  });

  it('returns 404 when creating a receivable for a client that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/clients/does-not-exist/receivables')
      .send({ description: 'x', amount: 10, dueDate: '2026-01-01' })
      .expect(404);
  });
});
