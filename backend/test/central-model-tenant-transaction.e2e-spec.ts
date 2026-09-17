import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';

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
      .send({ companyName: 'Central Tx Co', email: adminEmail, password: 'senha-de-teste-12345' })
      .expect(201);
    adminToken = `Bearer ${registerRes.body.accessToken}`;

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = user.companyId;
  });

  afterAll(async () => {
    const schemaName = `tenant_${companyId}`;
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
        cpf: '99999999999',
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
        modules: ['DASHBOARD', 'CLIENTES', 'RH', 'COMERCIAL', 'OPERACOES', 'FINANCAS'],
      })
      .expect(201);
    const empUserId = loginRes.body.user.id;

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${empUserId}/block`)
      .set('Authorization', adminToken)
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email: empEmail, password: 'Mudar@123' })
      .expect(401);
  });

  it('PATCH .../ponto-access desliga hasFullPontoAccess de um segundo admin (User.count + User.update atômicos, sob advisory lock)', async () => {
    const admin2Email = `central-tx-admin2-${runId}@test.com`;
    const login2Res = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email: admin2Email, role: 'ADMIN', modules: ['DASHBOARD', 'CLIENTES', 'RH', 'COMERCIAL', 'OPERACOES', 'FINANCAS'] })
      .expect(201);
    const admin2UserId = login2Res.body.user.id;

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${admin2UserId}/ponto-access`)
      .set('Authorization', adminToken)
      .send({ hasFullPontoAccess: false })
      .expect(204);

    // O invariante ("pelo menos um full-access admin") continua protegido: desligar o próprio
    // fundador agora (o único que restou com acesso total) deve seguir rejeitado com 400.
    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    await request(app.getHttpServer())
      .patch(`/companies/me/users/${founder.id}/ponto-access`)
      .set('Authorization', adminToken)
      .send({ hasFullPontoAccess: false })
      .expect(400);
  });
});
