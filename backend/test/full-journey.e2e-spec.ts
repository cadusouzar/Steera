import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { markEmailVerified } from './access.util';
import { assertRowExistsInTenantSchema, selectBypassingRls } from './tenant-physical-read.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

describe('Percurso completo — login, criar, listar, editar, desativar (e2e, sem mocks)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let schemaName: string;
  let token: string;

  const runId = Date.now();
  const email = `full-journey-${runId}@test.com`;

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
      .send(buildRegisterBody({ companyName: 'Full Journey Co', email, password: 'senha-de-teste-12345' }))
      .expect(201);
    token = `Bearer ${registerRes.body.accessToken}`;
    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    companyId = user.companyId;
    schemaName = await getTenantSchemaName(prisma, companyId);
    await markEmailVerified(prisma, email);
  });

  afterAll(async () => {
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await app.close();
  });

  it('Clientes: criar → listar → editar → desativar, tudo fisicamente no schema do tenant', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/clients')
      .set('Authorization', token)
      .send({ name: 'Cliente Percurso', contact: '(11) 90000-0000' })
      .expect(201);
    const clientId = createRes.body.id;
    await assertRowExistsInTenantSchema(prisma, companyId, 'Client', { id: clientId });

    const listRes = await request(app.getHttpServer())
      .get('/clients?pageSize=100')
      .set('Authorization', token)
      .expect(200);
    expect((listRes.body.items as Array<{ id: string }>).some((c) => c.id === clientId)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/clients/${clientId}`)
      .set('Authorization', token)
      .send({ name: 'Cliente Percurso Editado' })
      .expect(200);
    const getRes = await request(app.getHttpServer())
      .get(`/clients/${clientId}`)
      .set('Authorization', token)
      .expect(200);
    expect(getRes.body.name).toBe('Cliente Percurso Editado');

    await request(app.getHttpServer())
      .patch(`/clients/${clientId}/deactivate`)
      .set('Authorization', token)
      .send({ includeInRevenueReport: true })
      .expect(200);
    const [row] = await selectBypassingRls<{ status: string }[]>(
      prisma,
      `SELECT status FROM "${schemaName}"."Client" WHERE id = '${clientId}'`,
    );
    expect(row.status).toBe('INACTIVE');
  });

  it('Cargos + Funcionários: criar → listar → editar → desativar, tudo fisicamente no schema do tenant', async () => {
    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', token)
      .send({ name: 'Cargo Percurso', department: 'Operações' })
      .expect(201);
    const roleId = roleRes.body.id;
    await assertRowExistsInTenantSchema(prisma, companyId, 'Role', { id: roleId });

    const empRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', token)
      .send({
        fullName: 'Funcionário Percurso',
        cpf: '11144477735',
        roleId,
        contractType: 'CLT',
        admissionDate: '2026-01-01',
        department: 'Operações',
        paymentDueDay: 5,
        baseValue: 4000,
      })
      .expect(201);
    const employeeId = empRes.body.id;
    await assertRowExistsInTenantSchema(prisma, companyId, 'Employee', { id: employeeId });

    const listRes = await request(app.getHttpServer())
      .get('/employees?pageSize=100')
      .set('Authorization', token)
      .expect(200);
    expect((listRes.body.items as Array<{ id: string }>).some((e) => e.id === employeeId)).toBe(true);

    await request(app.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set('Authorization', token)
      .send({ fullName: 'Funcionário Percurso Editado' })
      .expect(200);
    const getRes = await request(app.getHttpServer())
      .get(`/employees/${employeeId}`)
      .set('Authorization', token)
      .expect(200);
    expect(getRes.body.fullName).toBe('Funcionário Percurso Editado');

    await request(app.getHttpServer())
      .patch(`/employees/${employeeId}/deactivate`)
      .set('Authorization', token)
      .expect(200);
    const [row] = await selectBypassingRls<{ status: string }[]>(
      prisma,
      `SELECT status FROM "${schemaName}"."Employee" WHERE id = '${employeeId}'`,
    );
    expect(row.status).toBe('INACTIVE');
  });
});
