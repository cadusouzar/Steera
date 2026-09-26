import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { acceptInvite, markEmailVerified } from './access.util';
import { buildRegisterBody } from './register-body.util';
import { setCompanyPlan } from './plan.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// Achado durante a auditoria de segurança (17/09/2026): três call sites que fazem uma transação
// multi-operação tocando SÓ tabelas centrais (User/RefreshToken) — AuthService.changePassword,
// UsersService.block, UsersService.updatePontoAccess (branch de desligar) — usavam
// runTenantTransaction/runTenantInteractiveTransaction, que SEMPRE redireciona pro client de
// TENANT resolvido quando um registry+companyId estão ativos (o caso normal de qualquer requisição
// autenticada). Isso quebrava com "table tenant_x.User does not exist" (structured Prisma queries
// contra um client de tenant nunca alcançam uma tabela central — o schema é fixado na conexão, não
// no search_path) para TODA empresa com schema físico — ou seja, hoje, toda empresa nova. Na
// prática: nenhum funcionário criado por um admin conseguia completar a troca de senha obrigatória
// do primeiro acesso (ficava preso na tela de troca forçada pra sempre), bloquear um login também
// sempre falhava, e desligar hasFullPontoAccess de um admin também. Nenhum teste unitário (mockado)
// pega esse tipo de bug — só um teste e2e contra Postgres real, por isso este arquivo.
describe('Transações multi-operação em tabelas CENTRAIS funcionam para empresas com schema físico (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let adminToken: string;
  let administradorGeralId: string;

  const runId = Date.now();
  const adminEmail = `central-tx-admin-${runId}@test.com`;

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
      .send(buildRegisterBody({ companyName: 'Central Tx Co', email: adminEmail, password: 'senha-de-teste-12345' }))
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = user.companyId;
    // O fundador nasce vinculado ao perfil protegido "Administrador Geral" (todas as permissões) —
    // reaproveitado abaixo pra criar outros logins de teste sem precisar de um POST /profiles à
    // parte, mesmo padrão já usado em profiles-shared-permission-guard.e2e-spec.ts/
    // profiles-reassign-and-delete-guard.e2e-spec.ts.
    administradorGeralId = user.profileId!;
    await markEmailVerified(prisma, adminEmail);
    // Planos grátis e pagos (26/09/2026): empresa nova nasce GRATIS, sem PONTO_ADMINISTRACAO — este
    // arquivo exercita /employees/:id/time-events/correct e /employees/:id/time-summary, que exigem
    // esse módulo (ver comentário em EmployeesController). Nada aqui testa plano, então sobe pra
    // EMPRESARIAL antes de qualquer chamada.
    await setCompanyPlan(prisma, companyId, 'EMPRESARIAL');
  });

  afterAll(async () => {
    const schemaName = await getTenantSchemaName(prisma, companyId);
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
    await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await app.close();
  });

  it('PATCH /auth/me/password conclui a troca de senha (User.update + RefreshToken.updateMany atômicos)', async () => {
    const changeRes = await request(app.getHttpServer())
      .patch('/auth/me/password')
      .set('Authorization', adminToken)
      .send({ currentPassword: 'senha-de-teste-12345', newPassword: 'nova-senha-12345' })
      .expect(200);
    expect(changeRes.body.accessToken).toEqual(expect.any(String));

    // A senha antiga deixou de funcionar e a nova funciona — prova que o UPDATE realmente persistiu.
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: adminEmail, password: 'senha-de-teste-12345' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: adminEmail, password: 'nova-senha-12345' })
      .expect(201);
  });

  it('PATCH /companies/me/users/:id/block bloqueia um login de verdade (User.update + RefreshToken.updateMany atômicos)', async () => {
    const empEmail = `central-tx-emp-${runId}@test.com`;
    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', adminToken)
      .send({ name: 'Cargo Teste', department: 'Depto Teste' })
      .expect(201);
    const empRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', adminToken)
      .send({
        fullName: 'Funcionário Teste',
        cpf: '11144477735',
        roleId: roleRes.body.id,
        contractType: 'CLT',
        admissionDate: '2026-01-01',
        department: 'Depto Teste',
        baseValue: 3000,
        paymentDueDay: 5,
      })
      .expect(201);
    const loginRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({
        email: empEmail,
        role: 'EMPLOYEE',
        employeeId: empRes.body.id,
        profileId: administradorGeralId,
      })
      .expect(201);
    const empUserId = loginRes.body.user.id;

    // "Acesso e sessões" (26/09/2026): o login nasce INVITED, sem senha conhecida (o convite
    // substituiu a antiga senha temporária fixa) — pra provar o 403 de bloqueio com a senha CERTA
    // (ver comentário abaixo), o convite precisa ser aceito ANTES do bloqueio, definindo uma senha
    // conhecida.
    await acceptInvite(app, loginRes.body.inviteUrl, 'senha-propria-do-bloqueado-123');

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${empUserId}/block`)
      .set('Authorization', adminToken)
      .expect(204);

    // 403 com mensagem específica, não mais o 401 genérico — mudança da auditoria de segurança de
    // 17/09/2026 (ver AuthService.login()): a senha aqui está CORRETA (a que o próprio login
    // definiu ao aceitar o convite), então é seguro revelar que a conta está bloqueada.
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: empEmail, password: 'senha-propria-do-bloqueado-123' })
      .expect(403);
    expect(res.body.message).toMatch(/bloqueado/i);
  });

  // O teste que existia aqui ("PATCH .../ponto-access desliga hasFullPontoAccess de um segundo
  // admin") cobria UsersService.updatePontoAccess(), removido na Fase 2a (19/09/2026,
  // authorization-profiles-screen/Task 8) — `hasFullPontoAccess` deixou de ser editável em
  // separado, agora é sempre DERIVADO do Perfil do login (ver
  // UsersService.assignProfile/reassignUserProfile). A regressão de transação central que este
  // arquivo documenta (query estruturada contra `User` central quebrando dentro de um client de
  // TENANT) segue coberta pelos outros dois testes deste describe (troca de senha, bloqueio de
  // login) — `assignProfile()` usa exatamente o mesmo padrão seguro (transação montada à mão no
  // client central, `set_config` manual) desde a sua implementação, então não introduz uma
  // variante nova desse bug pra testar aqui.

  // Achado ao vivo (18/09/2026, "Espelho de Ponto demora ~5s pra carregar"):
  // TimeAttendanceCalculationService.calculateDailySummary passou a agrupar suas leituras de
  // tabela de TENANT (TimeEvent/WorkSchedule/VacationSchedule/LeaveSchedule) numa única
  // `runTenantInteractiveTransaction` por dia — uma primeira versão desse fix também colocou
  // `Company` (tabela CENTRAL) dentro dessa mesma transação, achando (incorretamente) que o
  // `SET LOCAL search_path` do setup da transação faria uma query ESTRUTURADA (`tx.company...`)
  // resolver via o fallback pra `public`. Não resolve: só SQL bruto se beneficia do search_path em
  // runtime — uma query estruturada do Prisma é sempre qualificada pelo schema FIXO da conexão do
  // client. `GET /employees/:id/time-summary` quebrava com 500 ("a tabela Company não existe") pra
  // TODA empresa com schema físico assim que o mês pedido tivesse ao menos 1 dia — nenhum teste
  // unitário (mockado) pegava isso, só um teste e2e contra Postgres real, por isso aqui (mesmo
  // arquivo/motivo do teste de troca de senha acima).
  it('GET /employees/:id/time-summary calcula o mês sem quebrar (Employee+Company central, eventos/escala de tenant, tudo lido corretamente)', async () => {
    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', adminToken)
      .send({ name: 'Cargo Summary', department: 'Depto Summary' })
      .expect(201);
    const empRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', adminToken)
      .send({
        fullName: 'Funcionário Summary',
        cpf: '52998224725',
        roleId: roleRes.body.id,
        contractType: 'CLT',
        admissionDate: '2026-01-01',
        department: 'Depto Summary',
        baseValue: 3000,
        paymentDueDay: 5,
      })
      .expect(201);
    const employeeId = empRes.body.id;

    const now = new Date();
    const past = new Date(now.getTime() - 60_000).toISOString();
    await request(app.getHttpServer())
      .post(`/employees/${employeeId}/time-events/correct`)
      .set('Authorization', adminToken)
      .send({
        targetDate: now.toISOString().slice(0, 10),
        type: 'ADD_MISSING_PUNCH',
        requestedEventType: 'CLOCK_IN',
        requestedTime: past,
        reason: 'teste e2e — entrada',
      })
      .expect(201);

    const summaryRes = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/time-summary?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`)
      .set('Authorization', adminToken)
      .expect(200);

    expect(Array.isArray(summaryRes.body.days)).toBe(true);
    expect(summaryRes.body.days.length).toBeGreaterThan(0);
    const today = summaryRes.body.days.find((d: { date: string }) => d.date === now.toISOString().slice(0, 10));
    expect(today).toBeDefined();
    expect(today.hasOpenJourney).toBe(true); // CLOCK_IN sem CLOCK_OUT ainda
  });
});
