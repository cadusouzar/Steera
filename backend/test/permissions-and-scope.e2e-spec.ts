import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified } from './access.util';
import { setCompanyPlan } from './plan.util';
import { buildRegisterBody, randomValidCpf } from './register-body.util';
import { selectBypassingRls } from './tenant-physical-read.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

type Grant = { permissionCode: string; scope: 'PROPRIO' | 'EQUIPE' | 'DEPARTAMENTO' | 'EMPRESA' | null };

// Permissões por ação e alcance (27/09/2026): cada rota de negócio exige uma permissão do Perfil
// (403 PERMISSION_REQUIRED quando falta) e as rotas de Funcionários e dependentes aplicam o alcance
// (fora dele → 404, nunca 403). Uma empresa só, com hierarquia real:
//   Gestor ──manager de──> Subordinado      Outsider (sem gestor)
// Tudo contra Postgres real, com logins de verdade (convite aceito, login com senha).
describe('Permissões por ação e alcance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let founderToken: string;

  const runId = Date.now();
  const founderEmail = `perm-scope-founder-${runId}@test.com`;
  const password = 'senha-de-teste-12345';

  let roleId: string;
  let clientId: string;
  let gestorId: string;
  let subordinadoId: string;
  let outsiderId: string;
  let viewerEmployeeId: string;
  let usersMgrEmployeeId: string;
  let invitedEmployeeId: string;

  let viewerToken: string;
  let gestorToken: string;
  let proprioToken: string;
  let usersMgrToken: string;
  let adminNoEmployeeToken: string;

  let proprioProfileId: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => `Bearer ${token}`;

  async function createProfile(name: string, grants: Grant[]): Promise<string> {
    const res = await http().post('/profiles').set('Authorization', auth(founderToken)).send({ name, grants }).expect(201);
    return res.body.id;
  }

  async function createEmployee(fullName: string, managerId?: string): Promise<string> {
    const res = await http()
      .post('/employees')
      .set('Authorization', auth(founderToken))
      .send({
        fullName, cpf: randomValidCpf(), roleId, contractType: 'CLT', admissionDate: '2026-01-01',
        department: 'Operações', baseValue: 3000, paymentDueDay: 5, ...(managerId ? { managerId } : {}),
      })
      .expect(201);
    return res.body.id;
  }

  // Cria o login pelo fundador, aceita o convite e faz login — o token já nasce com as permissões
  // do perfil (elas viajam no JWT).
  async function createLogin(opts: { role: 'ADMIN' | 'EMPLOYEE'; profileId: string; employeeId?: string }): Promise<string> {
    const email = `perm-scope-${Math.random().toString(36).slice(2)}-${runId}@test.com`;
    const res = await http()
      .post('/companies/me/users')
      .set('Authorization', auth(founderToken))
      .send({ email, role: opts.role, profileId: opts.profileId, ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) })
      .expect(201);
    await acceptInvite(app, res.body.inviteUrl, password);
    const loginRes = await http()
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email, password })
      .expect(201);
    return loginRes.body.accessToken;
  }

  async function createPayment(employeeId: string): Promise<string> {
    const res = await http()
      .post(`/employees/${employeeId}/payments`)
      .set('Authorization', auth(founderToken))
      .send({ description: 'Bônus', amount: 150, dueDate: '2026-12-10' })
      .expect(201);
    return res.body.id;
  }

  async function readPaymentRow(paymentId: string): Promise<{ status: string; paidAt: Date | null; updatedAt: Date }> {
    const schemaName = await getTenantSchemaName(prisma, companyId);
    const rows = await selectBypassingRls<{ status: string; paidAt: Date | null; updatedAt: Date }[]>(
      prisma,
      `SELECT "status"::text AS status, "paidAt", "updatedAt" FROM "${schemaName}"."EmployeePayment" WHERE "id" = '${paymentId}'`,
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  function expectPermissionRequired(res: request.Response): void {
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PERMISSION_REQUIRED');
    expect(res.body.message).toMatch(/^Seu perfil não permite (ver|alterar) .+\. Fale com quem administra os acessos da empresa\.$/);
  }

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

    const reg = await http()
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Permissoes Alcance Co', email: founderEmail, password }))
      .expect(201);
    founderToken = reg.body.accessToken;
    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: founderEmail } }));
    companyId = founder.companyId;
    await markEmailVerified(prisma, founderEmail);
    // Vários logins EMPLOYEE (GRATIS aceita só 2).
    await setCompanyPlan(prisma, companyId, 'EMPRESARIAL');

    roleId = (await http().post('/roles').set('Authorization', auth(founderToken)).send({ name: 'Analista', department: 'Operações' }).expect(201)).body.id;
    clientId = (await http().post('/clients').set('Authorization', auth(founderToken)).send({ name: 'Cliente A', contact: 'Fulano' }).expect(201)).body.id;

    gestorId = await createEmployee('Gestor Equipe');
    subordinadoId = await createEmployee('Subordinado Direto', gestorId);
    outsiderId = await createEmployee('Fora da Equipe');
    viewerEmployeeId = await createEmployee('Leitor');
    usersMgrEmployeeId = await createEmployee('Gerente de Acessos');
    invitedEmployeeId = await createEmployee('Convidado Novo');

    const viewerProfileId = await createProfile('Só ver', [
      { permissionCode: 'clientes.ver', scope: 'EMPRESA' },
      { permissionCode: 'cargos.ver', scope: 'EMPRESA' },
      { permissionCode: 'funcionarios.ver', scope: 'EMPRESA' },
    ]);
    const gestorProfileId = await createProfile('Gestor de equipe', [
      { permissionCode: 'funcionarios.ver', scope: 'EQUIPE' },
      { permissionCode: 'pagamentos.gerenciar', scope: 'EQUIPE' },
    ]);
    proprioProfileId = await createProfile('Só a própria ficha', [{ permissionCode: 'funcionarios.ver', scope: 'PROPRIO' }]);
    const usersMgrProfileId = await createProfile('Gerente de acessos', [{ permissionCode: 'usuarios.gerenciar', scope: 'EMPRESA' }]);
    // Perfil de equipe SEM usuarios.gerenciar, pra um login ADMIN sem ficha vinculada.
    const adminLimitedProfileId = await createProfile('Admin limitado', [{ permissionCode: 'funcionarios.ver', scope: 'EQUIPE' }]);

    viewerToken = await createLogin({ role: 'EMPLOYEE', profileId: viewerProfileId, employeeId: viewerEmployeeId });
    gestorToken = await createLogin({ role: 'EMPLOYEE', profileId: gestorProfileId, employeeId: gestorId });
    proprioToken = await createLogin({ role: 'EMPLOYEE', profileId: proprioProfileId, employeeId: subordinadoId });
    usersMgrToken = await createLogin({ role: 'EMPLOYEE', profileId: usersMgrProfileId, employeeId: usersMgrEmployeeId });
    adminNoEmployeeToken = await createLogin({ role: 'ADMIN', profileId: adminLimitedProfileId });
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.userToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  describe('perfil "só ver" em Clientes, Cargos e Funcionários', () => {
    it('lê (200) nas três áreas', async () => {
      await http().get('/clients').set('Authorization', auth(viewerToken)).expect(200);
      await http().get(`/clients/${clientId}`).set('Authorization', auth(viewerToken)).expect(200);
      await http().get('/roles').set('Authorization', auth(viewerToken)).expect(200);
      await http().get(`/roles/${roleId}`).set('Authorization', auth(viewerToken)).expect(200);
      await http().get('/employees').set('Authorization', auth(viewerToken)).expect(200);
      await http().get(`/employees/${outsiderId}`).set('Authorization', auth(viewerToken)).expect(200);
    });

    it('não cria nem altera (403 PERMISSION_REQUIRED) e nada muda no banco', async () => {
      const token = auth(viewerToken);
      expectPermissionRequired(await http().post('/clients').set('Authorization', token).send({ name: 'Novo', contact: 'X' }));
      expectPermissionRequired(await http().patch(`/clients/${clientId}`).set('Authorization', token).send({ name: 'Alterado' }));
      expectPermissionRequired(await http().post('/roles').set('Authorization', token).send({ name: 'Novo cargo', department: 'D' }));
      expectPermissionRequired(await http().patch(`/roles/${roleId}`).set('Authorization', token).send({ name: 'Alterado' }));
      expectPermissionRequired(
        await http().post('/employees').set('Authorization', token).send({
          fullName: 'Intruso', cpf: randomValidCpf(), roleId, contractType: 'CLT', admissionDate: '2026-01-01',
          department: 'Operações', baseValue: 3000, paymentDueDay: 5,
        }),
      );
      expectPermissionRequired(await http().patch(`/employees/${outsiderId}`).set('Authorization', token).send({ fullName: 'Alterado' }));

      // Mensagem com a área em pt-BR.
      const res = await http().patch(`/clients/${clientId}`).set('Authorization', token).send({ name: 'Alterado' });
      expect(res.body.message).toBe('Seu perfil não permite alterar Clientes. Fale com quem administra os acessos da empresa.');

      const client = await http().get(`/clients/${clientId}`).set('Authorization', auth(founderToken)).expect(200);
      expect(client.body.name).toBe('Cliente A');
      const role = await http().get(`/roles/${roleId}`).set('Authorization', auth(founderToken)).expect(200);
      expect(role.body.name).toBe('Analista');
      const employee = await http().get(`/employees/${outsiderId}`).set('Authorization', auth(founderToken)).expect(200);
      expect(employee.body.fullName).toBe('Fora da Equipe');
    });

    it('sem a permissão da área (Lançamentos) → 403 PERMISSION_REQUIRED', async () => {
      // Lançamentos ficam sob o módulo CLIENTES (que o perfil tem, via clientes.ver) — quem barra é o
      // PermissionsGuard, por falta de financas.lancamentos.ver.
      const res = await http().get(`/clients/${clientId}/receivables`).set('Authorization', auth(viewerToken));
      expectPermissionRequired(res);
      expect(res.body.message).toBe('Seu perfil não permite ver Lançamentos. Fale com quem administra os acessos da empresa.');
    });
  });

  describe('alcance EQUIPE (gestor)', () => {
    it('lista só ele e os subordinados diretos', async () => {
      const res = await http().get('/employees').set('Authorization', auth(gestorToken)).expect(200);
      const ids = (res.body.items as { id: string }[]).map((e) => e.id).sort();
      expect(ids).toEqual([gestorId, subordinadoId].sort());
      expect(res.body.total).toBe(2);
    });

    it('ficha própria e do subordinado: 200; ficha de fora: 404', async () => {
      await http().get(`/employees/${gestorId}`).set('Authorization', auth(gestorToken)).expect(200);
      await http().get(`/employees/${subordinadoId}`).set('Authorization', auth(gestorToken)).expect(200);
      await http().get(`/employees/${outsiderId}`).set('Authorization', auth(gestorToken)).expect(404);
    });

    it('advertências: do subordinado 200, de alguém de fora 404', async () => {
      await http().get(`/employees/${subordinadoId}/warnings`).set('Authorization', auth(gestorToken)).expect(200);
      await http().get(`/employees/${outsiderId}/warnings`).set('Authorization', auth(gestorToken)).expect(404);
    });

    it('PATCH /employee-payments/:id/pay de alguém de fora da equipe → 404 e a linha fica intacta', async () => {
      const paymentId = await createPayment(outsiderId);
      const before = await readPaymentRow(paymentId);
      expect(before.status).toBe('PENDING');

      await http().patch(`/employee-payments/${paymentId}/pay`).set('Authorization', auth(gestorToken)).expect(404);
      await http().get(`/employee-payments/${paymentId}`).set('Authorization', auth(gestorToken)).expect(404);

      const after = await readPaymentRow(paymentId);
      expect(after.status).toBe('PENDING');
      expect(after.paidAt).toBeNull();
      expect(new Date(after.updatedAt).getTime()).toBe(new Date(before.updatedAt).getTime());
    });

    it('controle positivo: paga o pagamento do subordinado (200) — o 404 acima é alcance, não falta de permissão', async () => {
      const paymentId = await createPayment(subordinadoId);
      await http().patch(`/employee-payments/${paymentId}/pay`).set('Authorization', auth(gestorToken)).expect(200);
      const after = await readPaymentRow(paymentId);
      expect(after.status).toBe('PAID');
    });
  });

  describe('alcance PROPRIO', () => {
    it('lista e abre só a própria ficha', async () => {
      const res = await http().get('/employees').set('Authorization', auth(proprioToken)).expect(200);
      expect((res.body.items as { id: string }[]).map((e) => e.id)).toEqual([subordinadoId]);
      await http().get(`/employees/${subordinadoId}`).set('Authorization', auth(proprioToken)).expect(200);
      await http().get(`/employees/${gestorId}`).set('Authorization', auth(proprioToken)).expect(404);
      await http().get(`/employees/${outsiderId}`).set('Authorization', auth(proprioToken)).expect(404);
    });
  });

  describe('login sem ficha vinculada + alcance restrito', () => {
    it('EQUIPE sem Employee vinculado → lista vazia e qualquer ficha 404', async () => {
      const res = await http().get('/employees').set('Authorization', auth(adminNoEmployeeToken)).expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
      await http().get(`/employees/${gestorId}`).set('Authorization', auth(adminNoEmployeeToken)).expect(404);
    });
  });

  describe('gestão de logins por permissão, não por papel', () => {
    it('EMPLOYEE com usuarios.gerenciar cria um login (convite)', async () => {
      const email = `perm-scope-invited-${runId}@test.com`;
      const res = await http()
        .post('/companies/me/users')
        .set('Authorization', auth(usersMgrToken))
        .send({ email, role: 'EMPLOYEE', employeeId: invitedEmployeeId, profileId: proprioProfileId })
        .expect(201);
      expect(res.body.inviteUrl).toEqual(expect.any(String));
      const created = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
      expect(created.status).toBe('INVITED');
      expect(created.companyId).toBe(companyId);
    });

    it('ADMIN com perfil sem usuarios.gerenciar → 403 PERMISSION_REQUIRED (listar e criar)', async () => {
      expectPermissionRequired(await http().get('/companies/me/users').set('Authorization', auth(adminNoEmployeeToken)));
      const email = `perm-scope-denied-${runId}@test.com`;
      expectPermissionRequired(
        await http()
          .post('/companies/me/users')
          .set('Authorization', auth(adminNoEmployeeToken))
          .send({ email, role: 'EMPLOYEE', employeeId: outsiderId, profileId: proprioProfileId }),
      );
      const denied = await sys(() => prisma.user.findUnique({ where: { email } }));
      expect(denied).toBeNull();
    });
  });

  describe('Administrador Geral (EMPRESA) sem regressão', () => {
    it('vê todos, abre qualquer ficha, advertências e pagamentos de qualquer um, e altera', async () => {
      const token = auth(founderToken);
      const res = await http().get('/employees').set('Authorization', token).expect(200);
      const ids = (res.body.items as { id: string }[]).map((e) => e.id);
      for (const id of [gestorId, subordinadoId, outsiderId, viewerEmployeeId, usersMgrEmployeeId, invitedEmployeeId]) {
        expect(ids).toContain(id);
      }
      await http().get(`/employees/${outsiderId}`).set('Authorization', token).expect(200);
      await http()
        .post(`/employees/${outsiderId}/warnings`)
        .set('Authorization', token)
        .send({ occurredAt: '2026-09-01', reason: 'Atraso' })
        .expect(201);
      await http().get(`/employees/${outsiderId}/warnings`).set('Authorization', token).expect(200);

      const paymentId = await createPayment(outsiderId);
      await http().patch(`/employee-payments/${paymentId}/pay`).set('Authorization', token).expect(200);
      expect((await readPaymentRow(paymentId)).status).toBe('PAID');

      await http().patch(`/clients/${clientId}`).set('Authorization', token).send({ name: 'Cliente A editado' }).expect(200);
      await http().get('/companies/me/users').set('Authorization', token).expect(200);
    });
  });
});
