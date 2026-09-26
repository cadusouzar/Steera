import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { FORGOT_PASSWORD_MESSAGE } from '../src/auth/auth.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { EMAIL_SENDER } from '../src/email/email-sender';
import { FakeEmailSender } from '../src/email/fake-email.sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { acceptInvite, tokenFromLink, waitForEmail } from './access.util';
import { setCompanyPlan } from './plan.util';
import { buildRegisterBody, randomValidCpf } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

const sys = <T>(fn: () => Promise<T>) => runAsSystem(fn);
const PASSWORD = 'senha-de-teste-12345';
const CSRF_HEADER = { 'x-requested-with': 'XMLHttpRequest' };
const allow = { canActivate: () => true };

// Cobre o plano "Acesso e sessões" (26/09/2026) de ponta a ponta contra Postgres real: confirmação de
// e-mail do fundador (EmailVerifiedGuard), convite de login EMPLOYEE por e-mail (sem senha
// temporária), bloqueio temporário de conta por senha errada (com e-mail de aviso e reset por
// token), esqueci-minha-senha anti-enumeração e a interação entre bloqueio de admin (BLOCKED) e
// redefinição de senha. Mesmo padrão de bootstrap/limpeza de plans.e2e-spec.ts/
// account-profile-edit.e2e-spec.ts, com `EMAIL_SENDER` trocado por um FakeEmailSender (nunca envia
// e-mail de verdade) pra poder inspecionar o link de cada token direto do corpo do e-mail capturado.
describe('Acesso e sessões — confirmação de e-mail, convites e bloqueio temporário (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fake: FakeEmailSender;
  let companyId: string;
  let adminToken: string;
  let adminEmail: string;
  let profileId: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Cada teste que precisa de um login EMPLOYEE de verdade cria seu próprio Cargo + Funcionário +
  // convite — mais verboso que reaproveitar um único login entre casos, mas mantém cada cenário
  // (confirmação, convite, bloqueio, esqueci-senha, bloqueio de admin, corrida de trava) livre de
  // qualquer estado deixado por outro caso.
  async function inviteEmployeeLogin(label: string): Promise<{ userId: string; email: string; inviteUrl: string }> {
    const roleRes = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', adminToken)
      .send({ name: `Cargo ${label}`, department: `Depto ${label}` })
      .expect(201);
    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', adminToken)
      .send({
        fullName: `Funcionário ${label}`,
        cpf: randomValidCpf(),
        roleId: roleRes.body.id,
        contractType: 'CLT',
        admissionDate: '2026-01-01',
        department: `Depto ${label}`,
        baseValue: 3000,
        paymentDueDay: 5,
      })
      .expect(201);
    const email = `access-${label}-${runId}@test.com`;
    const createRes = await request(app.getHttpServer())
      .post('/companies/me/users')
      .set('Authorization', adminToken)
      .send({ email, role: 'EMPLOYEE', employeeId: employeeRes.body.id, profileId })
      .expect(201);
    expect(createRes.body.temporaryPassword).toBeUndefined();
    expect(typeof createRes.body.inviteUrl).toBe('string');
    return { userId: createRes.body.user.id, email, inviteUrl: createRes.body.inviteUrl };
  }

  beforeAll(async () => {
    if (!/\/quickflow_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    fake = new FakeEmailSender();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard).useValue(allow)
      .overrideGuard(FriendlyThrottlerGuard).useValue(allow)
      .overrideProvider(EMAIL_SENDER).useValue(fake)
      .compile();
    app = moduleRef.createNestApplication();
    // src/main.ts registra cookie-parser via app.use() (não como um Nest module/middleware
    // registrado no AppModule) — o bootstrap de teste (Test.createTestingModule + app.init(), nunca
    // a função bootstrap() de main.ts) precisa registrar o mesmo middleware manualmente, senão
    // req.cookies fica sempre undefined e POST /auth/refresh nunca lê o cookie `rt` de verdade
    // (nenhuma outra suíte precisou disso até agora — esta é a primeira a exercitar /auth/refresh).
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    adminEmail = `access-founder-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set(CSRF_HEADER)
      .send(buildRegisterBody({ companyName: 'Empresa Acesso e Sessões', email: adminEmail, password: PASSWORD }))
      .expect(201);
    adminToken = `Bearer ${res.body.accessToken}`;
    const founder = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
    companyId = founder.companyId;
    profileId = founder.profileId!;
    // Empresa nova nasce GRATIS (teto de 2 logins de funcionário) — esta suíte cria um login EMPLOYEE
    // por caso de teste (4 no total), então sobe o plano pra não esbarrar num 403 de limite que não
    // tem nada a ver com o que está sendo testado aqui (ver plan-catalog.ts).
    await setCompanyPlan(prisma, companyId, 'BASICO');
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId } }));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.userToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  // Precisa rodar primeiro: confirma o e-mail do fundador usando o fluxo real (não markEmailVerified,
  // que é só pra OUTRAS suítes pularem esta etapa) — os casos seguintes deste arquivo já dependem do
  // fundador estar confirmado pra poder criar Cargo/Funcionário/login.
  it('1. cadastro exige confirmação de e-mail (EmailVerifiedGuard) antes de liberar o ERP; o link confirma e não pode ser reusado', async () => {
    const blocked = await request(app.getHttpServer()).get('/roles').set('Authorization', adminToken).expect(403);
    expect(blocked.body.code).toBe('EMAIL_NOT_VERIFIED');

    const me = await request(app.getHttpServer()).get('/auth/me').set('Authorization', adminToken).expect(200);
    expect(me.body.emailVerified).toBe(false);
    expect(me.body.emailVerificationRequired).toBe(true);

    const message = await waitForEmail(fake, adminEmail);
    if (!message) throw new Error('e-mail de confirmação não foi capturado pelo FakeEmailSender');
    const token = tokenFromLink(message.text, '/confirmar-email');

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set(CSRF_HEADER)
      .send({ token })
      .expect(204);

    // Mesmo access token de antes (nenhum novo login) — prova que o guard relê o banco a cada
    // requisição em vez de confiar só no claim `emailVerificationPending` gravado no token antigo.
    await request(app.getHttpServer()).get('/roles').set('Authorization', adminToken).expect(200);

    // Token de verificação já consumido — reusar dá 400 (link inválido/expirado), nunca 204 de novo.
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .set(CSRF_HEADER)
      .send({ token })
      .expect(400);
  });

  it('2. admin convida um login EMPLOYEE por e-mail (sem temporaryPassword); status INVITED até o convite ser aceito', async () => {
    const { userId, email, inviteUrl } = await inviteEmployeeLogin('convite');

    const list = await request(app.getHttpServer()).get('/companies/me/users').set('Authorization', adminToken).expect(200);
    const invited = list.body.find((u: { id: string }) => u.id === userId);
    expect(invited?.status).toBe('INVITED');

    const message = await waitForEmail(fake, email);
    if (!message) throw new Error('e-mail de convite não foi capturado pelo FakeEmailSender');
    // O link do e-mail carrega o MESMO token da resposta da API (inviteUrl) — não dois convites
    // diferentes emitidos por engano.
    expect(inviteUrl).toContain(tokenFromLink(message.text, '/aceitar-convite'));

    await acceptInvite(app, inviteUrl, 'senha-do-convidado-123');

    await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-do-convidado-123' })
      .expect(201);
  });

  it('3. 5 senhas erradas travam a conta temporariamente (e-mail de aviso com link de redefinição); o refresh cookie anterior ao bloqueio fica inválido', async () => {
    const { email, inviteUrl } = await inviteEmployeeLogin('bloqueio');
    await acceptInvite(app, inviteUrl, 'senha-original-123');
    fake.clear();

    // Login certo ANTES do bloqueio — guarda o cookie de refresh pra provar, no fim do teste, que ele
    // deixa de valer quando a conta trava (mesmo padrão de invalidação de sessão de troca de senha).
    const firstLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-original-123' })
      .expect(201);
    const rtCookie = (firstLogin.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('rt='));
    if (!rtCookie) throw new Error('cookie de refresh não encontrado na resposta de login');

    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set(CSRF_HEADER)
        .send({ email, password: 'senha-errada' })
        .expect(401);
    }

    const sixth = await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-original-123' })
      .expect(403);
    expect(sixth.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');

    const lockMessage = await waitForEmail(fake, email);
    if (!lockMessage) throw new Error('e-mail de bloqueio temporário não foi capturado pelo FakeEmailSender');
    const resetToken = tokenFromLink(lockMessage.text, '/redefinir-senha');

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set(CSRF_HEADER)
      .send({ token: resetToken, newPassword: 'senha-redefinida-456' })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-redefinida-456' })
      .expect(201);

    // resetPassword revoga toda sessão ativa — o cookie emitido pelo login de ANTES do bloqueio não
    // serve mais.
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rtCookie).expect(401);
  });

  it('4. esqueci minha senha com e-mail inexistente devolve a mesma mensagem genérica e não dispara e-mail nenhum', async () => {
    const nonExistentEmail = `nao-existe-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set(CSRF_HEADER)
      .send({ email: nonExistentEmail })
      .expect(202);
    expect(res.body.message).toBe(FORGOT_PASSWORD_MESSAGE);

    // Sem await extra: forgotPassword() não faz NENHUMA chamada de negócio pra um e-mail sem conta
    // (nem issue() nem send()), então não há nada a esperar via polling — a ausência já é garantida
    // no mesmo instante da resposta.
    expect(fake.lastTo(nonExistentEmail)).toBeUndefined();
  });

  it('5. login bloqueado por um admin (BLOCKED) continua bloqueado mesmo depois do dono redefinir a própria senha', async () => {
    const { userId, email, inviteUrl } = await inviteEmployeeLogin('bloqueio-admin');
    await acceptInvite(app, inviteUrl, 'senha-inicial-789');
    // waitForEmail pega a mensagem mais RECENTE pro endereço — sem isso, ele acharia de volta o
    // e-mail de convite (já capturado acima) em vez de esperar o de redefinição disparado abaixo.
    fake.clear();

    await request(app.getHttpServer())
      .patch(`/companies/me/users/${userId}/block`)
      .set('Authorization', adminToken)
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set(CSRF_HEADER)
      .send({ email })
      .expect(202);
    const resetMessage = await waitForEmail(fake, email);
    if (!resetMessage) throw new Error('e-mail de redefinição não foi capturado pelo FakeEmailSender');
    const token = tokenFromLink(resetMessage.text, '/redefinir-senha');

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set(CSRF_HEADER)
      .send({ token, newPassword: 'senha-redefinida-por-cima-000' })
      .expect(204);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set(CSRF_HEADER)
      .send({ email, password: 'senha-redefinida-por-cima-000' })
      .expect(403);
    expect(loginRes.body.message).toMatch(/bloqueado/i);
  });

  // Além do brief: corrida real contra Postgres — duas tentativas de senha errada disparadas ao
  // mesmo tempo contra uma conta cujo contador já está a 1 tentativa do limite (achado documentado em
  // AuthService.recordFailedLogin: duas queries condicionais, não uma transação única, então só um
  // teste concorrente de verdade contra Postgres prova que a corrida não manda dois e-mails/trava
  // duas vezes).
  it('6. duas tentativas de senha errada concorrentes com o contador a 1 do limite travam a conta uma única vez (um só e-mail de aviso)', async () => {
    const { email, userId, inviteUrl } = await inviteEmployeeLogin('corrida');
    await acceptInvite(app, inviteUrl, 'senha-corrida-123');
    fake.clear();

    await sys(() => prisma.user.update({ where: { id: userId }, data: { failedLoginAttempts: 4 } }));

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set(CSRF_HEADER).send({ email, password: 'senha-errada-1' }),
      request(app.getHttpServer()).post('/auth/login').set(CSRF_HEADER).send({ email, password: 'senha-errada-2' }),
    ]);
    // Login() sempre responde a mesma mensagem genérica pra senha errada, mesmo na tentativa que
    // acabou de travar a conta como efeito colateral — as duas respostas concorrentes são 401.
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);

    const after = await sys(() => prisma.user.findUniqueOrThrow({ where: { id: userId } }));
    expect(after.failedLoginAttempts).toBe(0);
    expect(after.lockedUntil).not.toBeNull();

    // O e-mail de aviso é disparado em segundo plano (runInBackground) — a resposta HTTP não espera
    // por ele, então checar fake.sent na hora seria uma corrida real. waitForEmail faz o polling.
    const lockMessage = await waitForEmail(fake, email);
    if (!lockMessage) throw new Error('e-mail de bloqueio temporário não foi capturado pelo FakeEmailSender');
    const lockMessages = fake.sent.filter((m) => m.to === email);
    expect(lockMessages).toHaveLength(1);
  });
});
