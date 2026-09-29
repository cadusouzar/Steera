import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
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
  let restrictedUsersMgrToken: string;

  let proprioProfileId: string;

  // DEPARTAMENTO: dois departamentos reais (tabela de tenant, sem rota HTTP) e fichas ligadas por
  // departmentId — é ele, não o texto livre `department`, que define o alcance.
  let deptLeaderId: string;
  let deptPeerId: string;
  let otherDeptEmployeeId: string;
  let departmentToken: string;

  // Vínculo login <-> ficha feito por quem gerencia usuários.
  let linkTargetEmployeeId: string;
  let secondLinkTargetEmployeeId: string;

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

  async function createDepartment(name: string): Promise<string> {
    const schemaName = await getTenantSchemaName(prisma, companyId);
    const id = `dept-${Math.random().toString(36).slice(2)}-${runId}`;
    await writeBypassingRls(
      `INSERT INTO "${schemaName}"."Department" ("id", "companyId", "name", "active") VALUES ('${id}', '${companyId}', '${name}', true)`,
    );
    return id;
  }

  async function setEmployeeDepartment(employeeId: string, departmentId: string): Promise<void> {
    const schemaName = await getTenantSchemaName(prisma, companyId);
    await writeBypassingRls(`UPDATE "${schemaName}"."Employee" SET "departmentId" = '${departmentId}' WHERE "id" = '${employeeId}'`);
  }

  // Mesmo motivo de selectBypassingRls: SQL bruto não passa pelo bypass de runAsSystem, então o
  // set_config vai na MESMA transação.
  function writeBypassingRls(sql: string): Promise<unknown> {
    return sys(() =>
      prisma.$transaction([prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`, prisma.$executeRawUnsafe(sql)]),
    );
  }

  async function currentUserId(token: string): Promise<string> {
    const res = await http().get('/auth/me').set('Authorization', auth(token)).expect(200);
    return res.body.id;
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
    // Throttlers sobrescritos (mesmo padrão de users-management/access-and-sessions): a suíte aceita
    // mais de 10 convites (limite por IP de POST /auth/accept-invite) desde os casos do ruling F1b.
    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard).useValue(allow)
      .overrideGuard(FriendlyThrottlerGuard).useValue(allow)
      .compile();
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
    // Concessão limitada (28/09/2026): quem gerencia acessos só concede/age sobre o que também tem —
    // este gerente cria e vincula logins com o perfil "Só a própria ficha", então precisa cobrir
    // `funcionarios.ver@PROPRIO`. Ruling F1b (28/09/2026): vincular um login a uma ficha exige
    // alcance EMPRESA em tudo, então este gerente tem `funcionarios.ver@EMPRESA` (que cobre PROPRIO).
    const usersMgrProfileId = await createProfile('Gerente de acessos', [
      { permissionCode: 'usuarios.gerenciar', scope: 'EMPRESA' },
      { permissionCode: 'funcionarios.ver', scope: 'EMPRESA' },
    ]);
    // Ruling F1b: gerente de acessos de alcance restrito, SEM ficha — não vincula ninguém (nem a si).
    const restrictedUsersMgrProfileId = await createProfile('Gerente de acessos restrito', [
      { permissionCode: 'usuarios.gerenciar', scope: 'EMPRESA' },
      { permissionCode: 'funcionarios.ver', scope: 'PROPRIO' },
    ]);
    // Perfil de equipe SEM usuarios.gerenciar, pra um login ADMIN sem ficha vinculada.
    const adminLimitedProfileId = await createProfile('Admin limitado', [{ permissionCode: 'funcionarios.ver', scope: 'EQUIPE' }]);

    viewerToken = await createLogin({ role: 'EMPLOYEE', profileId: viewerProfileId, employeeId: viewerEmployeeId });
    gestorToken = await createLogin({ role: 'EMPLOYEE', profileId: gestorProfileId, employeeId: gestorId });
    proprioToken = await createLogin({ role: 'EMPLOYEE', profileId: proprioProfileId, employeeId: subordinadoId });
    usersMgrToken = await createLogin({ role: 'EMPLOYEE', profileId: usersMgrProfileId, employeeId: usersMgrEmployeeId });
    adminNoEmployeeToken = await createLogin({ role: 'ADMIN', profileId: adminLimitedProfileId });
    restrictedUsersMgrToken = await createLogin({ role: 'ADMIN', profileId: restrictedUsersMgrProfileId });

    deptLeaderId = await createEmployee('Líder Departamento X');
    deptPeerId = await createEmployee('Colega Departamento X');
    otherDeptEmployeeId = await createEmployee('Pessoa Departamento Y');
    const deptX = await createDepartment('Departamento X');
    const deptY = await createDepartment('Departamento Y');
    await setEmployeeDepartment(deptLeaderId, deptX);
    await setEmployeeDepartment(deptPeerId, deptX);
    await setEmployeeDepartment(otherDeptEmployeeId, deptY);
    const departmentProfileId = await createProfile('Ver o departamento', [{ permissionCode: 'funcionarios.ver', scope: 'DEPARTAMENTO' }]);
    departmentToken = await createLogin({ role: 'EMPLOYEE', profileId: departmentProfileId, employeeId: deptLeaderId });

    linkTargetEmployeeId = await createEmployee('Ficha Para Vincular');
    secondLinkTargetEmployeeId = await createEmployee('Segunda Ficha Para Vincular');
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

  describe('alcance DEPARTAMENTO', () => {
    it('lista exatamente as fichas do mesmo departamento (departmentId)', async () => {
      const res = await http().get('/employees').set('Authorization', auth(departmentToken)).expect(200);
      const ids = (res.body.items as { id: string }[]).map((e) => e.id).sort();
      expect(ids).toEqual([deptLeaderId, deptPeerId].sort());
      expect(res.body.total).toBe(2);
    });

    it('ficha do mesmo departamento: 200; de outro departamento ou sem departamento: 404', async () => {
      await http().get(`/employees/${deptPeerId}`).set('Authorization', auth(departmentToken)).expect(200);
      await http().get(`/employees/${otherDeptEmployeeId}`).set('Authorization', auth(departmentToken)).expect(404);
      await http().get(`/employees/${outsiderId}`).set('Authorization', auth(departmentToken)).expect(404);
    });
  });

  describe('auto-vínculo a uma ficha (PATCH /auth/me/employee-link)', () => {
    it('ADMIN sem ficha, com alcance EQUIPE e sem usuarios.gerenciar → 403 com a mensagem exata e continua sem vínculo', async () => {
      const userId = await currentUserId(adminNoEmployeeToken);
      const res = await http()
        .patch('/auth/me/employee-link')
        .set('Authorization', auth(adminNoEmployeeToken))
        .send({ employeeId: gestorId });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PERMISSION_REQUIRED');
      expect(res.body.message).toBe(
        'Seu acesso está ligado aos seus próprios dados, mas seu login ainda não tem uma ficha de funcionário. Peça a quem administra os acessos para vincular.',
      );

      const row = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: userId } }));
      expect(row.employeeId).toBeNull();
      // O alcance continua vazio: a tentativa não abriu a equipe do gestor.
      await http().get(`/employees/${subordinadoId}`).set('Authorization', auth(adminNoEmployeeToken)).expect(404);
    });

    it('GET /auth/me expõe canSelfLinkEmployee: false pra esse login', async () => {
      const res = await http().get('/auth/me').set('Authorization', auth(adminNoEmployeeToken)).expect(200);
      expect(res.body.canSelfLinkEmployee).toBe(false);
    });
  });

  describe('vínculo feito por quem gerencia usuários', () => {
    it('com usuarios.gerenciar: lista a ficha, vincula outro login, a ficha some da lista e não vincula de novo', async () => {
      const targetToken = await createLogin({ role: 'ADMIN', profileId: proprioProfileId });
      const targetUserId = await currentUserId(targetToken);
      const otherToken = await createLogin({ role: 'ADMIN', profileId: proprioProfileId });
      const otherUserId = await currentUserId(otherToken);
      const token = auth(usersMgrToken);

      const before = await http().get('/companies/me/users/linkable-employees').set('Authorization', token).expect(200);
      expect(before.body).toContainEqual({ id: linkTargetEmployeeId, fullName: 'Ficha Para Vincular' });

      const linked = await http()
        .patch(`/companies/me/users/${targetUserId}/employee`)
        .set('Authorization', token)
        .send({ employeeId: linkTargetEmployeeId })
        .expect(200);
      expect(linked.body.id).toBe(targetUserId);
      expect(linked.body.employeeId).toBe(linkTargetEmployeeId);
      const row = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: targetUserId } }));
      expect(row.employeeId).toBe(linkTargetEmployeeId);

      const after = await http().get('/companies/me/users/linkable-employees').set('Authorization', token).expect(200);
      const afterIds = (after.body as { id: string }[]).map((e) => e.id);
      expect(afterIds).not.toContain(linkTargetEmployeeId);
      expect(afterIds).toContain(secondLinkTargetEmployeeId);

      // Mesma ficha pra outro login → 400; e o login já vinculado não troca de ficha.
      const takenEmployee = await http()
        .patch(`/companies/me/users/${otherUserId}/employee`)
        .set('Authorization', token)
        .send({ employeeId: linkTargetEmployeeId });
      expect(takenEmployee.status).toBe(400);
      expect(takenEmployee.body.message).toBe('Este funcionário já possui um login vinculado');
      const alreadyLinked = await http()
        .patch(`/companies/me/users/${targetUserId}/employee`)
        .set('Authorization', token)
        .send({ employeeId: secondLinkTargetEmployeeId });
      expect(alreadyLinked.status).toBe(400);
      expect(alreadyLinked.body.message).toBe('Este login já está vinculado a um funcionário');

      expect((await sys(() => prisma.user.findUniqueOrThrow({ where: { id: otherUserId } }))).employeeId).toBeNull();
      expect((await sys(() => prisma.user.findUniqueOrThrow({ where: { id: targetUserId } }))).employeeId).toBe(linkTargetEmployeeId);
    });

    it('sem usuarios.gerenciar → 403 PERMISSION_REQUIRED nas duas rotas e nada é vinculado', async () => {
      const targetToken = await createLogin({ role: 'ADMIN', profileId: proprioProfileId });
      const targetUserId = await currentUserId(targetToken);
      const token = auth(adminNoEmployeeToken);

      expectPermissionRequired(await http().get('/companies/me/users/linkable-employees').set('Authorization', token));
      expectPermissionRequired(
        await http()
          .patch(`/companies/me/users/${targetUserId}/employee`)
          .set('Authorization', token)
          .send({ employeeId: secondLinkTargetEmployeeId }),
      );
      expect((await sys(() => prisma.user.findUniqueOrThrow({ where: { id: targetUserId } }))).employeeId).toBeNull();
    });
  });

  // Ruling F1b (28/09/2026): o alcance PROPRIO/EQUIPE/DEPARTAMENTO é ancorado na ficha vinculada ao
  // login. Um gerente de acessos de alcance restrito que vinculasse a si mesmo (ou outro login) à
  // ficha de outro gestor passaria a alcançar a equipe desse gestor.
  describe('vínculo por gerente de acessos de alcance restrito (ruling F1b)', () => {
    const LINK_MSG = 'Só quem tem acesso a todos os funcionários da empresa pode vincular um login a uma ficha.';

    it('não vincula a si mesmo nem outro login à ficha do gestor (PATCH :id/employee e auto-vínculo) e nada é gravado', async () => {
      const token = auth(restrictedUsersMgrToken);
      const selfId = await currentUserId(restrictedUsersMgrToken);
      const targetToken = await createLogin({ role: 'ADMIN', profileId: proprioProfileId });
      const targetUserId = await currentUserId(targetToken);
      // Outro gestor, com equipe e ainda sem login (ficha vinculável).
      const otherManagerId = await createEmployee('Outro Gestor Sem Login');
      const otherTeamMemberId = await createEmployee('Equipe do Outro Gestor', otherManagerId);

      for (const userId of [selfId, targetUserId]) {
        const res = await http().patch(`/companies/me/users/${userId}/employee`).set('Authorization', token).send({ employeeId: otherManagerId });
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ statusCode: 403, code: 'PERMISSION_REQUIRED', message: LINK_MSG });
      }
      const self = await http().patch('/auth/me/employee-link').set('Authorization', token).send({ employeeId: otherManagerId });
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('PERMISSION_REQUIRED');
      expect(self.body.message).toBe(
        'Seu acesso está ligado aos seus próprios dados, mas seu login ainda não tem uma ficha de funcionário. Peça a quem administra os acessos para vincular.',
      );

      expect((await sys(() => prisma.user.findUniqueOrThrow({ where: { id: selfId } }))).employeeId).toBeNull();
      expect((await sys(() => prisma.user.findUniqueOrThrow({ where: { id: targetUserId } }))).employeeId).toBeNull();
      expect(await sys(() => prisma.user.findUnique({ where: { employeeId: otherManagerId } }))).toBeNull();
      // A equipe do outro gestor continua fora do alcance.
      await http().get(`/employees/${otherTeamMemberId}`).set('Authorization', token).expect(404);
      const me = await http().get('/auth/me').set('Authorization', token).expect(200);
      expect(me.body.canSelfLinkEmployee).toBe(false);
    });

    it('não cria login EMPLOYEE (que nasce vinculado a uma ficha) e nada é criado', async () => {
      const email = `perm-scope-f1b-${runId}@test.com`;
      const res = await http()
        .post('/companies/me/users')
        .set('Authorization', auth(restrictedUsersMgrToken))
        .send({ email, role: 'EMPLOYEE', employeeId: secondLinkTargetEmployeeId, profileId: proprioProfileId });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ statusCode: 403, code: 'PERMISSION_REQUIRED', message: LINK_MSG });
      expect(await sys(() => prisma.user.findUnique({ where: { email } }))).toBeNull();
    });
  });

  // Ruling R-final (29/09/2026): o link cru do convite deixaria um gerente de acessos de alcance
  // restrito aceitar o convite pendente de um login já vinculado à ficha de outro gestor e alcançar
  // a equipe dele sem passar por rota de vínculo nenhuma. Pra quem não vincula fichas, o e-mail sai
  // igual e a resposta vem com `inviteUrl: null`; `linkable-employees` recusa com a mensagem do F1b.
  describe('convite pendente por gerente de acessos de alcance restrito (ruling R-final)', () => {
    const LINK_MSG = 'Só quem tem acesso a todos os funcionários da empresa pode vincular um login a uma ficha.';
    let equipeUsersMgrToken: string;
    let pendingUserId: string;

    beforeAll(async () => {
      const equipeUsersMgrProfileId = await createProfile('Gerente de acessos de equipe', [
        { permissionCode: 'usuarios.gerenciar', scope: 'EMPRESA' },
        { permissionCode: 'funcionarios.ver', scope: 'EQUIPE' },
      ]);
      equipeUsersMgrToken = await createLogin({ role: 'ADMIN', profileId: equipeUsersMgrProfileId });

      // Login EMPLOYEE pendente, vinculado à ficha de outro gestor (com equipe), com perfil dentro do
      // poder do gerente restrito (funcionarios.ver@EQUIPE).
      const teamProfileId = await createProfile('Ver a equipe', [{ permissionCode: 'funcionarios.ver', scope: 'EQUIPE' }]);
      const managerBId = await createEmployee('Gestor B Convite Pendente');
      await createEmployee('Equipe do Gestor B', managerBId);
      const email = `perm-scope-pending-${runId}@test.com`;
      const res = await http()
        .post('/companies/me/users')
        .set('Authorization', auth(founderToken))
        .send({ email, role: 'EMPLOYEE', employeeId: managerBId, profileId: teamProfileId })
        .expect(201);
      pendingUserId = res.body.user.id;
      expect(res.body.inviteUrl).toEqual(expect.any(String));
    });

    it('reenviar convite (e redefinir senha de login pendente) → 200 sem link; o fundador recebe o link', async () => {
      const resend = await http()
        .patch(`/companies/me/users/${pendingUserId}/resend-invite`)
        .set('Authorization', auth(equipeUsersMgrToken));
      expect(resend.status).toBe(200);
      expect(resend.body.inviteUrl).toBeNull();
      expect(typeof resend.body.sent).toBe('boolean');

      const reset = await http()
        .patch(`/companies/me/users/${pendingUserId}/reset-password`)
        .set('Authorization', auth(equipeUsersMgrToken));
      expect(reset.status).toBe(200);
      expect(reset.body.inviteUrl).toBeNull();

      const founderResend = await http()
        .patch(`/companies/me/users/${pendingUserId}/resend-invite`)
        .set('Authorization', auth(founderToken))
        .expect(200);
      expect(founderResend.body.inviteUrl).toEqual(expect.stringContaining('/aceitar-convite?token='));

      const row = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: pendingUserId } }));
      expect(row.status).toBe('INVITED');
    });

    it('GET linkable-employees → 403 com a mensagem do F1b', async () => {
      const res = await http().get('/companies/me/users/linkable-employees').set('Authorization', auth(equipeUsersMgrToken));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ statusCode: 403, code: 'PERMISSION_REQUIRED', message: LINK_MSG });
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

  // "Pode alterar os próprios dados?" (28/09/2026): mexer na PRÓPRIA ficha exige
  // funcionarios.proprios.gerenciar além de funcionarios.gerenciar + alcance. Fora do alcance
  // continua 404; dentro do alcance, na própria ficha e sem a permissão, 403 com a mensagem exata.
  describe('alterar os próprios dados', () => {
    const OWN_DENIED = {
      statusCode: 403,
      code: 'PERMISSION_REQUIRED',
      message: 'Seu perfil não permite alterar os próprios dados. Fale com quem administra os acessos da empresa.',
    };
    const editorGrants: Grant[] = [
      { permissionCode: 'funcionarios.ver', scope: 'EQUIPE' },
      { permissionCode: 'funcionarios.gerenciar', scope: 'EQUIPE' },
    ];
    let editorProfileId: string;
    let editorEmployeeId: string;
    let editorReportId: string;
    let editorEmail: string;
    let editorToken: string;

    async function readBaseValue(employeeId: string): Promise<number> {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      const rows = await selectBypassingRls<{ baseValue: string }[]>(
        prisma,
        `SELECT "baseValue"::text AS "baseValue" FROM "${schemaName}"."Employee" WHERE "id" = '${employeeId}'`,
      );
      expect(rows).toHaveLength(1);
      return Number(rows[0].baseValue);
    }

    async function login(email: string): Promise<string> {
      const res = await http().post('/auth/login').set('x-requested-with', 'XMLHttpRequest').send({ email, password }).expect(201);
      return res.body.accessToken;
    }

    beforeAll(async () => {
      editorEmployeeId = await createEmployee('Gestor Que Edita');
      editorReportId = await createEmployee('Subordinado Do Gestor Que Edita', editorEmployeeId);
      editorProfileId = await createProfile('Gestor que edita a equipe', editorGrants);
      editorEmail = `perm-scope-own-${runId}@test.com`;
      const res = await http()
        .post('/companies/me/users')
        .set('Authorization', auth(founderToken))
        .send({ email: editorEmail, role: 'EMPLOYEE', profileId: editorProfileId, employeeId: editorEmployeeId })
        .expect(201);
      await acceptInvite(app, res.body.inviteUrl, password);
      editorToken = await login(editorEmail);
    });

    it('sem a permissão: PATCH na própria ficha → 403 exato e o salário não muda no banco', async () => {
      const before = await readBaseValue(editorEmployeeId);
      const res = await http()
        .patch(`/employees/${editorEmployeeId}`)
        .set('Authorization', auth(editorToken))
        .send({ baseValue: 99999 });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject(OWN_DENIED);
      expect(await readBaseValue(editorEmployeeId)).toBe(before);
    });

    it('sem a permissão: PATCH no subordinado → 200 e o salário muda', async () => {
      await http().patch(`/employees/${editorReportId}`).set('Authorization', auth(editorToken)).send({ baseValue: 4321 }).expect(200);
      expect(await readBaseValue(editorReportId)).toBe(4321);
    });

    it('fora do alcance continua 404 (não 403), mesmo sem a permissão', async () => {
      await http().patch(`/employees/${outsiderId}`).set('Authorization', auth(editorToken)).send({ baseValue: 1 }).expect(404);
    });

    // Achado 3 da revisão final: a recusa também vale nas rotas endereçadas pelo id do registro
    // (o dono é descoberto a partir do pagamento), não só em PATCH /employees/:id.
    it('sem a permissão: PATCH /employee-payments/:id/pay no pagamento da própria ficha → 403 exato e a linha fica intacta', async () => {
      const paymentId = await createPayment(gestorId);
      const before = await readPaymentRow(paymentId);
      expect(before.status).toBe('PENDING');

      const res = await http().patch(`/employee-payments/${paymentId}/pay`).set('Authorization', auth(gestorToken));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject(OWN_DENIED);

      const after = await readPaymentRow(paymentId);
      expect(after.status).toBe('PENDING');
      expect(after.paidAt).toBeNull();
      expect(new Date(after.updatedAt).getTime()).toBe(new Date(before.updatedAt).getTime());
    });

    it('sem a permissão: PATCH /employee-payments/:id/pay no pagamento do subordinado → 200', async () => {
      const paymentId = await createPayment(subordinadoId);
      await http().patch(`/employee-payments/${paymentId}/pay`).set('Authorization', auth(gestorToken)).expect(200);
      expect((await readPaymentRow(paymentId)).status).toBe('PAID');
    });

    it('com funcionarios.proprios.gerenciar no perfil (novo login): PATCH na própria ficha → 200', async () => {
      // O fundador (Administrador Geral semeado com o catálogo inteiro) tem a permissão, então pode concedê-la.
      await http()
        .patch(`/profiles/${editorProfileId}`)
        .set('Authorization', auth(founderToken))
        .send({ name: 'Gestor que edita a equipe', grants: [...editorGrants, { permissionCode: 'funcionarios.proprios.gerenciar', scope: null }] })
        .expect(200);
      const token = await login(editorEmail);
      await http().patch(`/employees/${editorEmployeeId}`).set('Authorization', auth(token)).send({ baseValue: 5555 }).expect(200);
      expect(await readBaseValue(editorEmployeeId)).toBe(5555);
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
