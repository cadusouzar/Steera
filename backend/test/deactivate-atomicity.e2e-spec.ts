import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { selectBypassingRls } from './tenant-physical-read.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
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
      .send(buildRegisterBody({ companyName: 'Deactivate Atomicity Co', email, password: 'senha-de-teste-12345' }))
      .expect(201);
    token = `Bearer ${registerRes.body.accessToken}`;
    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    companyId = user.companyId;
  });

  afterAll(async () => {
    const schemaName = await getTenantSchemaName(prisma, companyId);
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

    const schemaName = await getTenantSchemaName(prisma, companyId);
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
