import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { translateValidationErrors } from '../src/common/validation-message-translator.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { markEmailVerified } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// A coluna é timestamp SEM fuso: converter para UTC explicitamente, senão o Postgres usa o fuso da sessão.
// Atualiza paidAt direto no schema físico da empresa (a rota /pay sempre grava "agora"), com o
// bypass de RLS na MESMA transação — mesmo motivo documentado em tenant-physical-read.util.ts.
async function setPaidAt(prisma: PrismaService, schemaName: string, receivableId: string, paidAt: string) {
  await sys(() =>
    prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`,
      prisma.$executeRawUnsafe(`UPDATE "${schemaName}"."Receivable" SET "paidAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`, paidAt, receivableId),
    ]),
  );
}

describe('Relatório financeiro por período (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const companies: Array<{ id: string; token: string }> = [];
  const runId = Date.now();

  async function registerCompany(label: string) {
    const email = `report-period-${label}-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: `Report Period ${label}`, email, password: 'senha-de-teste-12345' }))
      .expect(201);
    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    await markEmailVerified(prisma, email);
    const company = { id: user.companyId, token: `Bearer ${res.body.accessToken}` };
    companies.push(company);
    return company;
  }

  async function createPaidReceivable(token: string, amount: number) {
    const server = app.getHttpServer();
    const client = await request(server).post('/clients').set('Authorization', token)
      .send({ name: `Cliente ${amount}`, contact: '(11) 90000-0000' }).expect(201);
    const rec = await request(server).post(`/clients/${client.body.id}/receivables`).set('Authorization', token)
      .send({ description: `Venda ${amount}`, amount, dueDate: '2026-10-05' }).expect(201);
    await request(server).patch(`/receivables/${rec.body.id}/pay`).set('Authorization', token).expect(200);
    return rec.body.id as string;
  }

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true,
      // Igual ao main.ts: sem isso a mensagem de validação chega como lista, não como texto.
      exceptionFactory: (errors) => new BadRequestException(translateValidationErrors(errors)) }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const { id } of companies) {
      const schemaName = await getTenantSchemaName(prisma, id);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId: id } }));
      await sys(() => prisma.company.delete({ where: { id } }));
    }
    await app.close();
  });

  it('um pagamento às 00:30 de 06/10 entra no fechamento 05/10 08:00 → 06/10 01:00 e fica fora do dia 05/10', async () => {
    const a = await registerCompany('a');
    const b = await registerCompany('b');
    const schemaA = await getTenantSchemaName(prisma, a.id);
    const schemaB = await getTenantSchemaName(prisma, b.id);

    const lateNight = await createPaidReceivable(a.token, 120);
    await setPaidAt(prisma, schemaA, lateNight, '2026-10-06T03:30:00.000Z'); // 06/10 00:30 em SP
    const afternoon = await createPaidReceivable(a.token, 80);
    await setPaidAt(prisma, schemaA, afternoon, '2026-10-05T17:00:00.000Z'); // 05/10 14:00 em SP
    const otherCompany = await createPaidReceivable(b.token, 999);
    await setPaidAt(prisma, schemaB, otherCompany, '2026-10-05T17:00:00.000Z');

    const server = app.getHttpServer();
    const shift = await request(server)
      .get('/reports/financial-summary')
      .query({ from: '2026-10-05T11:00:00.000Z', to: '2026-10-06T04:00:59.999Z' })
      .set('Authorization', a.token)
      .expect(200);
    expect(shift.body.totalPaid).toBe(200);
    expect(shift.body.receipts.map((r: { amount: number }) => r.amount)).toEqual([80, 120]);

    const calendarDay = await request(server)
      .get('/reports/financial-summary')
      .query({ from: '2026-10-05T03:00:00.000Z', to: '2026-10-06T02:59:59.999Z' })
      .set('Authorization', a.token)
      .expect(200);
    expect(calendarDay.body.totalPaid).toBe(80);
    expect(calendarDay.body.receipts).toHaveLength(1);

    const noPeriod = await request(server).get('/reports/financial-summary').set('Authorization', a.token).expect(200);
    expect(noPeriod.body.totalPaid).toBe(200);
    expect(noPeriod.body.period).toBeNull();
    expect(noPeriod.body.receipts).toEqual([]);
  });

  it('período inválido devolve 400 com mensagem em português', async () => {
    const { token } = companies[0];
    const server = app.getHttpServer();
    const onlyFrom = await request(server).get('/reports/financial-summary')
      .query({ from: '2026-10-05T11:00:00.000Z' }).set('Authorization', token).expect(400);
    expect(onlyFrom.body.message).toBe('Informe o início e o fim do período.');
    const reversed = await request(server).get('/reports/financial-summary')
      .query({ from: '2026-10-06T00:00:00.000Z', to: '2026-10-05T00:00:00.000Z' }).set('Authorization', token).expect(400);
    expect(reversed.body.message).toBe('O início do período precisa ser antes do fim.');
    const garbage = await request(server).get('/reports/financial-summary')
      .query({ from: 'ontem', to: '2026-10-05T00:00:00.000Z' }).set('Authorization', token).expect(400);
    expect(garbage.body.message).toBe('Data de início do período inválida.');
  });
});
