import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified } from './access.util';
import { buildRegisterBody, randomValidCpf } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

const sys = <T>(fn: () => Promise<T>) => runAsSystem(fn);
const PASSWORD = 'senha-de-teste-12345';
const allow = { canActivate: () => true };

describe('Edição da própria conta — PATCH /auth/me e /auth/me/company (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let adminToken: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const companyBody = {
    legalName: '  Razão Editada Ltda  ',
    tradeName: 'Fantasia Editada',
    phone: '(21) 3333-4444',
    zipCode: '20031-170',
    street: 'Avenida Rio Branco',
    number: '1',
    complement: 'Sala 10',
    district: 'Centro',
    city: 'Rio de Janeiro',
    state: 'RJ',
  };

  beforeAll(async () => {
    if (!/\/quickflow_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard).useValue(allow)
      .overrideGuard(FriendlyThrottlerGuard).useValue(allow)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const email = `account-edit-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Conta Original', email, password: PASSWORD }))
      .expect(201);
    adminToken = `Bearer ${res.body.accessToken}`;
    companyId = (await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }))).companyId;
    await markEmailVerified(prisma, email);
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId } }));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  it('PATCH /auth/me troca o nome do próprio login (com trim) e devolve o perfil', async () => {
    const res = await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', adminToken)
      .send({ name: '  Nome Editado  ' })
      .expect(200);
    expect(res.body.name).toBe('Nome Editado');
  });

  it('PATCH /auth/me recusa nome só com espaços e campos fora do DTO (e-mail)', async () => {
    await request(app.getHttpServer()).patch('/auth/me').set('Authorization', adminToken).send({ name: '   ' }).expect(400);
    await request(app.getHttpServer())
      .patch('/auth/me')
      .set('Authorization', adminToken)
      .send({ name: 'Ok', email: 'outro@test.com' })
      .expect(400);
  });

  it('ADMIN edita os dados da empresa; nome de exibição acompanha a fantasia; documento e schema não mudam', async () => {
    const before = await sys(() => prisma.company.findUniqueOrThrow({ where: { id: companyId } }));
    const res = await request(app.getHttpServer())
      .patch('/auth/me/company')
      .set('Authorization', adminToken)
      .send(companyBody)
      .expect(200);
    expect(res.body).toMatchObject({
      companyName: 'Fantasia Editada',
      legalName: 'Razão Editada Ltda',
      tradeName: 'Fantasia Editada',
      companyPhone: '2133334444',
      companyAddress: { zipCode: '20031170', street: 'Avenida Rio Branco', number: '1', complement: 'Sala 10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ' },
    });
    const after = await sys(() => prisma.company.findUniqueOrThrow({ where: { id: companyId } }));
    expect(after.document).toBe(before.document);
    expect(after.personType).toBe(before.personType);
    expect(after.schemaName).toBe(before.schemaName);
    expect(after.name).toBe('Fantasia Editada');
  });

  it('PJ não pode ficar sem nome fantasia; documento no corpo é recusado', async () => {
    await request(app.getHttpServer())
      .patch('/auth/me/company')
      .set('Authorization', adminToken)
      .send({ ...companyBody, tradeName: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/auth/me/company')
      .set('Authorization', adminToken)
      .send({ ...companyBody, document: '11222333000181' })
      .expect(400);
  });

  it('login EMPLOYEE (já com senha própria) edita o próprio nome mas recebe 403 nos dados da empresa', async () => {
    const admin = await sys(() => prisma.user.findFirstOrThrow({ where: { companyId, role: 'ADMIN' } }));
    // Login EMPLOYEE exige um Funcionário vinculado (e o Funcionário, um Cargo) — mesmo caminho de
    // granular-modules.e2e-spec.ts.
    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', adminToken)
      .send({ name: 'Cargo Conta', department: 'Depto Conta' })
      .expect(201);
    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', adminToken)
      .send({
        fullName: 'Funcionária Conta', cpf: randomValidCpf(), roleId: roleRes.body.id, contractType: 'CLT',
        admissionDate: '2026-01-01', department: 'Depto Conta', baseValue: 3000, paymentDueDay: 5,
      })
      .expect(201);
    const empEmail = `account-edit-emp-${runId}@test.com`;
    const createRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: empEmail, role: 'EMPLOYEE', employeeId: employeeRes.body.id, profileId: admin.profileId })
      .expect(201);
    await acceptInvite(app, createRes.body.inviteUrl, 'senha-propria-123');
    const firstLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: empEmail, password: 'senha-propria-123' })
      .expect(201);
    const empToken = `Bearer ${firstLogin.body.accessToken}`;

    await request(app.getHttpServer()).patch('/auth/me').set('Authorization', empToken).send({ name: 'Funcionária' }).expect(200);
    await request(app.getHttpServer()).patch('/auth/me/company').set('Authorization', empToken).send(companyBody).expect(403);
  });

  it('sem token: 401 nas duas rotas', async () => {
    await request(app.getHttpServer()).patch('/auth/me').send({ name: 'X' }).expect(401);
    await request(app.getHttpServer()).patch('/auth/me/company').send(companyBody).expect(401);
  });
});
