import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Tetos de tamanho/valor em DTOs (e2e)', () => {
  let app: INestApplication;
  const runId = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejeita um nome de empresa com mais de 255 caracteres no registro', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'A'.repeat(256), email: `len-${runId}@test.com`, password: 'senha-de-teste-12345' })
      .expect(400);
  });

  it('aceita um nome de empresa de exatamente 255 caracteres no registro', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'A'.repeat(255), email: `len-ok-${runId}@test.com`, password: 'senha-de-teste-12345' });
    expect(res.status).toBe(201);
  });

  it('rejeita uma descrição de recebível com mais de 2000 caracteres', async () => {
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Long Text Co', email: `longtext-${runId}@test.com`, password: 'senha-de-teste-12345' })
      .expect(201);
    const token = `Bearer ${reg.body.accessToken}`;

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Teste', contact: 'contato@teste.com' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/clients/${client.body.id}/receivables`)
      .set('Authorization', token)
      .send({ description: 'A'.repeat(2001), amount: 10, dueDate: '2026-12-01' })
      .expect(400);
  });

  it('rejeita um valor de recebível acima de 100 milhões', async () => {
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Big Amount Co', email: `bigamount-${runId}@test.com`, password: 'senha-de-teste-12345' })
      .expect(201);
    const token = `Bearer ${reg.body.accessToken}`;

    const client = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Teste 2', contact: 'contato2@teste.com' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/clients/${client.body.id}/receivables`)
      .set('Authorization', token)
      .send({ description: 'Fatura', amount: 100_000_001, dueDate: '2026-12-01' })
      .expect(400);
  });
});
