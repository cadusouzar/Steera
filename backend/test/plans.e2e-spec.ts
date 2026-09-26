import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { buildRegisterBody } from './register-body.util';
import { setCompanyPlan } from './plan.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

const sys = <T>(fn: () => Promise<T>) => runAsSystem(fn);
const PASSWORD = 'senha-de-teste-12345';
const allow = { canActivate: () => true };

// Cobre o gate de plano (PlanGuard, módulo fora do plano) e os limites de quantidade (RolesService,
// mesmo padrão em EmployeesService/UsersService) introduzidos em 26/09/2026 — ver
// .superpowers/sdd/2026-09-26-planos-gratis-e-pagos/2026-09-26-planos-gratis-e-pagos-design.md.
// Padrão de bootstrap/limpeza de account-profile-edit.e2e-spec.ts.
describe('Planos grátis e pagos — gate de módulo, limites e GET /plans/me (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let adminToken: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

    const email = `plans-${runId}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send(buildRegisterBody({ companyName: 'Empresa de Planos', email, password: PASSWORD }))
      .expect(201);
    adminToken = `Bearer ${res.body.accessToken}`;
    companyId = (await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }))).companyId;
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

  it('empresa nasce no plano GRATIS (GET /auth/me)', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').set('Authorization', adminToken).expect(200);
    expect(res.body.plan.tier).toBe('GRATIS');
  });

  it('rota @RequireModule(PONTO_ADMINISTRACAO) dá 403 PLAN_UPGRADE_REQUIRED no plano GRATIS, e passa a funcionar assim que a empresa sobe pra BASICO — sem novo login', async () => {
    // GET /time-clock/status e as demais rotas @RequireModule('PONTO_REGISTRO') (auto-atendimento)
    // exigem um Employee vinculado ao login (TimeManagementAuthService.resolveOwnEmployee) — o
    // ADMIN fundador criado via /auth/register nunca tem um. Usamos em vez disso
    // GET /time-adjustment-requests (listagem administrativa, @RequireModule('PONTO_ADMINISTRACAO'))
    // — mesmo plano mínimo BASICO (PONTO_ADMINISTRACAO entra no catálogo junto de PONTO_REGISTRO,
    // ver plan-catalog.ts) e sem exigir Employee: um ADMIN com hasFullPontoAccess (default) enxerga
    // 'ALL' em TimeManagementAuthService.getManageableEmployeeIds, sem precisar de vínculo próprio.
    const blocked = await request(app.getHttpServer())
      .get('/time-adjustment-requests')
      .set('Authorization', adminToken)
      .expect(403);
    expect(blocked.body).toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED', requiredPlan: 'BASICO' });

    await setCompanyPlan(prisma, companyId, 'BASICO');

    // Mesmo token de antes: prova de que o PlanGuard lê o plano do banco a cada requisição, sem
    // cache e sem precisar de um novo /auth/login.
    await request(app.getHttpServer()).get('/time-adjustment-requests').set('Authorization', adminToken).expect(200);
  });

  it('limite de cargos ativos do plano GRATIS (5): o 6º cargo dá 403 com a mensagem do catálogo; inativar 1 libera espaço', async () => {
    await setCompanyPlan(prisma, companyId, 'GRATIS');

    const createdIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/roles')
        .set('Authorization', adminToken)
        .send({ name: `Cargo Plano ${runId}-${i}`, department: 'Depto Planos' })
        .expect(201);
      createdIds.push(res.body.id);
    }

    const sixth = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', adminToken)
      .send({ name: `Cargo Plano ${runId}-5`, department: 'Depto Planos' })
      .expect(403);
    expect(sixth.body.message).toBe('Limite do plano Grátis: até 5 cargos ativos. Faça upgrade para cadastrar mais.');

    await request(app.getHttpServer())
      .patch(`/roles/${createdIds[0]}/deactivate`)
      .set('Authorization', adminToken)
      .expect(200);

    await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', adminToken)
      .send({ name: `Cargo Plano ${runId}-6`, department: 'Depto Planos' })
      .expect(201);
  });

  it('GET /plans/me devolve o plano atual, o uso e o catálogo inteiro', async () => {
    const res = await request(app.getHttpServer()).get('/plans/me').set('Authorization', adminToken).expect(200);
    expect(res.body.current.tier).toBe('GRATIS');
    expect(typeof res.body.usage.roles).toBe('number');
    expect(res.body.catalog).toHaveLength(4);
  });
});
