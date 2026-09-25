import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Scope } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { getPermissionDefinition } from '../src/permissions/permission-catalog';
import { MODULE_TO_PERMISSIONS } from '../src/permissions/profile-signature.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// Gera um CPF aleatório mas matematicamente válido (mesmo algoritmo de checksum de
// backend/src/common/cpf.util.ts) — desde a validação real de checksum, um número puramente
// aleatório de 11 dígitos quase sempre falha.
function generateValidCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const checkDigit = (digits: number[], firstWeight: number) => {
    const sum = digits.reduce((acc, d, i) => acc + d * (firstWeight - i), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = checkDigit(base, 10);
  const d2 = checkDigit([...base, d1], 11);
  return [...base, d1, d2].join('');
}

interface Fixture {
  app: INestApplication;
  prisma: PrismaService;
  companyId: string;
  adminToken: string;
  roleId: string;
  employeeId: string;
}

async function setupFixture(companyName: string, adminEmail: string): Promise<Fixture> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  const prisma = app.get(PrismaService);

  const registerRes = await request(app.getHttpServer())
    .post('/auth/register')
    .set('x-requested-with', 'XMLHttpRequest')
    .send(buildRegisterBody({ companyName, email: adminEmail, password: 'senha-de-teste-12345' }))
    .expect(201);
  const adminToken = `Bearer ${registerRes.body.accessToken}`;

  const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: adminEmail } }));
  const companyId = user.companyId;

  const roleRes = await request(app.getHttpServer())
    .post('/roles')
    .set('Authorization', adminToken)
    .send({ name: 'Cargo Teste', department: 'Depto Teste' })
    .expect(201);
  const roleId = roleRes.body.id;

  const empRes = await request(app.getHttpServer())
    .post('/employees')
    .set('Authorization', adminToken)
    .send({
      fullName: 'Funcionário Base', cpf: generateValidCpf(),
      roleId, contractType: 'CLT', admissionDate: '2026-01-01', department: 'Depto Teste',
      baseValue: 3000, paymentDueDay: 5,
    })
    .expect(201);
  const employeeId = empRes.body.id;

  return { app, prisma, companyId, adminToken, roleId, employeeId };
}

async function teardownFixture(f: Fixture): Promise<void> {
  const schemaName = await getTenantSchemaName(f.prisma, f.companyId);
  await sys(() => f.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
  await sys(() => f.prisma.tenantMigration.deleteMany({ where: { companyId: f.companyId } }));
  await sys(() => f.prisma.refreshToken.deleteMany({ where: { user: { companyId: f.companyId } } }));
  await sys(() => f.prisma.user.deleteMany({ where: { companyId: f.companyId } }));
  await sys(() => f.prisma.company.delete({ where: { id: f.companyId } }));
  await f.app.close();
}

// create() não aceita mais `modules` diretamente (Task 7, authorization-profiles-screen,
// `1a824c5`) — `modules`/`hasFullPontoAccess` de um login novo são sempre DERIVADOS do Perfil
// escolhido, nunca o inverso. Pra manter este arquivo fiel ao que cada módulo granular
// efetivamente concede (o próprio motivo dele existir), um Profile com EXATAMENTE as permissões
// dos módulos pedidos é criado primeiro (via POST /profiles, Task 6), reaproveitando o mesmo
// MODULE_TO_PERMISSIONS que o backend usa pra derivar módulos a partir de um perfil — na direção
// inversa aqui, mas a mesma fonte da verdade, então o teste nunca diverge silenciosamente do mapa
// real caso ele mude.
function grantsForModules(modules: string[]): { permissionCode: string; scope: Scope | null }[] {
  return modules.flatMap((m) =>
    (MODULE_TO_PERMISSIONS[m] ?? []).map((permissionCode) => {
      const def = getPermissionDefinition(permissionCode);
      return { permissionCode, scope: def.validScopes.length === 0 ? null : Scope.EMPRESA };
    }),
  );
}

async function createLoginAndLogin(f: Fixture, modules: string[]) {
  const email = `granular-${Math.random().toString(36).slice(2)}@test.com`;
  const profileRes = await request(f.app.getHttpServer())
    .post('/profiles')
    .set('Authorization', f.adminToken)
    .send({ name: `Teste ${modules.join('+')} ${Math.random().toString(36).slice(2)}`, grants: grantsForModules(modules) })
    .expect(201);
  const empRes = await request(f.app.getHttpServer())
    .post('/employees')
    .set('Authorization', f.adminToken)
    .send({
      fullName: 'Func Teste Modulo', cpf: generateValidCpf(),
      roleId: f.roleId, contractType: 'CLT', admissionDate: '2026-01-01', department: 'Depto Teste',
      baseValue: 3000, paymentDueDay: 5,
    })
    .expect(201);
  const loginRes = await request(f.app.getHttpServer())
    .post('/companies/me/users')
    .set('Authorization', f.adminToken)
    .send({ email, role: 'EMPLOYEE', employeeId: empRes.body.id, profileId: profileRes.body.id })
    .expect(201);
  const authRes = await request(f.app.getHttpServer())
    .post('/auth/login')
    .set('x-requested-with', 'XMLHttpRequest')
    .send({ email, password: loginRes.body.temporaryPassword })
    .expect(201);

  // Todo login criado por um admin nasce com mustChangePassword: true — JwtAuthGuard bloqueia
  // QUALQUER rota de negócio (independente de módulo) enquanto isso não for resolvido. Sem trocar
  // a senha aqui, todo teste abaixo tomaria 403 por esse motivo, nunca chegando a exercitar o
  // ModulesGuard de verdade.
  const changeRes = await request(f.app.getHttpServer())
    .patch('/auth/me/password')
    .set('Authorization', `Bearer ${authRes.body.accessToken}`)
    .send({ currentPassword: loginRes.body.temporaryPassword, newPassword: 'senha-propria-123' })
    .expect(200);

  return { token: `Bearer ${changeRes.body.accessToken}`, employeeId: empRes.body.id };
}

// Cobre o motivo de existir da reforma de módulos de 17/09/2026: dar pra criar um login que só
// bate o próprio ponto (PONTO_REGISTRO), sem enxergar a administração de Ponto
// (PONTO_ADMINISTRACAO) nem RH (RH_CARGOS/RH_FUNCIONARIOS) — os três agora são módulos
// independentes, onde antes "RH" cobria os três de uma vez.
//
// Dividido em dois `describe`, cada um com sua PRÓPRIA instância de app/empresa (nunca uma única
// compartilhada) — o mesmo motivo do arquivo de lockout: o ThrottlerGuard de /auth/login
// (5/15min por IP) usa armazenamento em memória por instância de app, e este arquivo no total
// precisa de mais de 5 chamadas de login pra cobrir todos os cenários.
describe('Módulos granulares — grupo 1 (e2e)', () => {
  let f: Fixture;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    f = await setupFixture('Granular Modules Co 1', `granular-admin1-${Date.now()}@test.com`);
  });

  afterAll(() => teardownFixture(f));

  it('um login só com PONTO_REGISTRO bate o próprio ponto mas não acessa RH nem Administração de Ponto', async () => {
    const { token } = await createLoginAndLogin(f, ['PONTO_REGISTRO']);
    await request(f.app.getHttpServer()).get('/time-clock/status').set('Authorization', token).expect(200);
    await request(f.app.getHttpServer()).get('/roles').set('Authorization', token).expect(403);
    await request(f.app.getHttpServer()).get('/employees').set('Authorization', token).expect(403);
    await request(f.app.getHttpServer()).get('/work-schedules').set('Authorization', token).expect(403);
    await request(f.app.getHttpServer()).get('/time-adjustment-requests').set('Authorization', token).expect(403);
  });

  it('um login sem PONTO_REGISTRO não consegue nem bater o próprio ponto', async () => {
    const { token } = await createLoginAndLogin(f, ['DASHBOARD']);
    await request(f.app.getHttpServer()).get('/time-clock/status').set('Authorization', token).expect(403);
  });

  it('RH_CARGOS e RH_FUNCIONARIOS são independentes — só um dos dois não dá acesso ao outro', async () => {
    const { token: cargosOnly } = await createLoginAndLogin(f, ['RH_CARGOS']);
    await request(f.app.getHttpServer()).get('/roles').set('Authorization', cargosOnly).expect(200);
    await request(f.app.getHttpServer()).get('/employees').set('Authorization', cargosOnly).expect(403);

    const { token: funcionariosOnly } = await createLoginAndLogin(f, ['RH_FUNCIONARIOS']);
    await request(f.app.getHttpServer()).get('/employees').set('Authorization', funcionariosOnly).expect(200);
    await request(f.app.getHttpServer()).get('/roles').set('Authorization', funcionariosOnly).expect(403);
  });
});

describe('Módulos granulares — grupo 2 (e2e)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await setupFixture('Granular Modules Co 2', `granular-admin2-${Date.now()}@test.com`);
  });

  afterAll(() => teardownFixture(f));

  it('PONTO_ADMINISTRACAO dá acesso à administração de Ponto sem dar RH nem PONTO_REGISTRO', async () => {
    const { token } = await createLoginAndLogin(f, ['PONTO_ADMINISTRACAO']);
    // GET /work-schedules sem filtro nenhum (a "empresa inteira") é uma camada de autorização
    // DIFERENTE e ortogonal ao módulo — assertHasFullPontoAccess exige role ADMIN + acesso total,
    // nunca satisfeito por um login EMPLOYEE nem por módulo nenhum (ver WorkSchedulesController).
    // O módulo aqui passa (é por isso que chega a 404 — a checagem de módulo nunca barra sozinha —
    // e não 403, que seria o ModulesGuard barrando antes de sequer entrar no controller).
    await request(f.app.getHttpServer()).get('/work-schedules').set('Authorization', token).expect(404);
    await request(f.app.getHttpServer()).get('/time-adjustment-requests').set('Authorization', token).expect(200);
    await request(f.app.getHttpServer()).get('/roles').set('Authorization', token).expect(403);
    await request(f.app.getHttpServer()).get('/employees').set('Authorization', token).expect(403);
    // Auto-atendimento (bater o próprio ponto) exige PONTO_REGISTRO especificamente —
    // PONTO_ADMINISTRACAO não substitui.
    await request(f.app.getHttpServer()).get('/time-clock/status').set('Authorization', token).expect(403);
  });

  it('as visões de ponto de um funcionário específico (GET /employees/:id/time-events|time-summary) exigem PONTO_ADMINISTRACAO, não RH_FUNCIONARIOS', async () => {
    const { token: funcionariosOnly } = await createLoginAndLogin(f, ['RH_FUNCIONARIOS']);
    await request(f.app.getHttpServer())
      .get(`/employees/${f.employeeId}/time-events`)
      .set('Authorization', funcionariosOnly)
      .expect(403);

    const { token: pontoAdmin } = await createLoginAndLogin(f, ['PONTO_ADMINISTRACAO']);
    // 404, não 403: PONTO_ADMINISTRACAO sozinho não faz o login "gerenciar" ninguém
    // (TimeManagementAuthService.assertCanManage ainda exige ser ADMIN ou o superior direto) — a
    // checagem de módulo passa, a de hierarquia nega, mesmo padrão 404-nunca-403 do resto do
    // Controle de Ponto.
    await request(f.app.getHttpServer())
      .get(`/employees/${f.employeeId}/time-events`)
      .set('Authorization', pontoAdmin)
      .expect(404);
  });

  it('o fundador (ADMIN via /auth/register) continua com acesso total a todos os módulos granulares novos', async () => {
    await request(f.app.getHttpServer()).get('/roles').set('Authorization', f.adminToken).expect(200);
    await request(f.app.getHttpServer()).get('/employees').set('Authorization', f.adminToken).expect(200);
    await request(f.app.getHttpServer()).get('/work-schedules').set('Authorization', f.adminToken).expect(200);

    // O fundador nunca tem um Employee vinculado por padrão (POST /auth/register nunca cria um) —
    // bater o PRÓPRIO ponto exige saber quem é "próprio", então PATCH /auth/me/employee-link é
    // pré-requisito aqui, ortogonal ao módulo em si (já teria bloqueado com uma mensagem própria,
    // não relacionada a módulo, sem isso). Confirma que o módulo PONTO_REGISTRO do fundador
    // realmente franqueia a rota, não só os outros três.
    await request(f.app.getHttpServer())
      .patch('/auth/me/employee-link')
      .set('Authorization', f.adminToken)
      .send({ employeeId: f.employeeId })
      .expect(200);
    await request(f.app.getHttpServer()).get('/time-clock/status').set('Authorization', f.adminToken).expect(200);
  });
});
