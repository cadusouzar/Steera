import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { TENANT_TABLE_NAMES } from '../src/prisma/tenant-table-names';
import { buildRegisterBody, randomValidCnpj, randomValidCpf } from './register-body.util';
import { assertRowAbsentFromPublicSchema, assertRowExistsInTenantSchema, selectBypassingRls } from './tenant-physical-read.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

const sys = <T>(fn: () => Promise<T>) => runAsSystem(fn);
const PASSWORD = 'senha-de-teste-12345';

describe('Cadastro ampliado + schema legível (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const runId = Date.now();
  const createdCompanyIds: string[] = [];

  beforeAll(async () => {
    if (!/\/quickflow_test(\?|$)/.test(process.env.DATABASE_URL ?? '')) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    // POST /auth/register é limitado a 5 requisições/15min por IP (FriendlyThrottlerGuard,
    // auth.controller.ts) — este arquivo faz mais de 5 chamadas de registro nos seus 6 testes (PJ,
    // PF, CNPJ repetido x2, sem nome fantasia, schema legado, tenant_directory), todas do mesmo IP
    // de teste contra a mesma instância de app. Sem esta sobrescrita, a partir da 6ª chamada o
    // throttler devolveria 429 em vez do status esperado pelo teste. Achado ao rodar esta suíte
    // (não previsto no brief): tenant-connection-stress.e2e-spec.ts já sobrescrevia só
    // `ThrottlerGuard`, mas `POST /auth/register` usa `FriendlyThrottlerGuard` (subclasse própria,
    // token de DI diferente, desde 18/09/2026) — aquela sobrescrita nunca teve efeito nenhum,
    // só nunca foi exercitada porque o corpo antigo de registro já quebrava na 1ª chamada antes de
    // qualquer teste chegar a fazer 6 chamadas. Sobrescrevendo os dois tokens aqui (e no arquivo de
    // stress) pra cobrir o guard que a rota realmente usa.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(FriendlyThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const companyId of createdCompanyIds) {
      const schemaName = await getTenantSchemaName(prisma, companyId);
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      // Mesma ordem de limpeza de profiles.e2e-spec.ts.
      await sys(() => prisma.profilePermission.deleteMany({ where: { companyId } }));
      await sys(() => prisma.profile.deleteMany({ where: { companyId } }));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.refreshToken.deleteMany({ where: { user: { companyId } } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  async function register(body: Record<string, unknown>) {
    const res = await request(app.getHttpServer()).post('/auth/register').set('x-requested-with', 'XMLHttpRequest').send(body);
    if (res.status === 201) {
      const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: body.email as string } }));
      createdCompanyIds.push(user.companyId);
      return { res, companyId: user.companyId };
    }
    return { res, companyId: undefined };
  }

  it('PJ: grava os dados, cria schema legível com as tabelas de tenant e roteia um Client pra ele', async () => {
    const email = `pj-${runId}@test.com`;
    const { res, companyId } = await register(
      buildRegisterBody({ email, password: PASSWORD, overrides: { tradeName: 'Açougue do Zé', legalName: 'José Carnes Ltda' } }),
    );
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Responsável de Teste', personType: 'PJ', tradeName: 'Açougue do Zé', companyName: 'Açougue do Zé' });
    expect(res.body.user.documentMasked).toMatch(/^\d{2}\.\d{3}\.\*\*\*\/\d{4}-\*\*$/);

    const schemaName = await getTenantSchemaName(prisma, companyId!);
    expect(schemaName).toBe(`acougue_do_ze_${companyId!.slice(-8)}`);

    const tables = await sys(() =>
      prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schemaName}'`,
      ),
    );
    const names = tables.map((t) => t.table_name);
    expect(names).toEqual(expect.arrayContaining([...TENANT_TABLE_NAMES]));
    expect(names).not.toEqual(expect.arrayContaining(['Company']));
    expect(names).not.toContain('User');

    const token = res.body.accessToken;
    const clientRes = await request(app.getHttpServer())
      .post('/clients').set('Authorization', `Bearer ${token}`).set('x-requested-with', 'XMLHttpRequest')
      .send({ name: `Cliente Roteado ${runId}`, contact: '(11) 90000-0000' });
    expect(clientRes.status).toBe(201);
    await assertRowExistsInTenantSchema(prisma, companyId!, 'Client', { id: clientRes.body.id });
    await assertRowAbsentFromPublicSchema(prisma, 'Client', { id: clientRes.body.id });
  });

  it('PF sem nome fantasia: schema vem do nome completo, CPF gravado só com dígitos', async () => {
    const email = `pf-${runId}@test.com`;
    const cpf = randomValidCpf();
    const { res, companyId } = await register(
      buildRegisterBody({ email, password: PASSWORD, overrides: { personType: 'PF', document: cpf, legalName: 'Ana Souza', tradeName: undefined } }),
    );
    expect(res.status).toBe(201);
    const company = await sys(() => prisma.company.findUniqueOrThrow({ where: { id: companyId! } }));
    expect(company).toMatchObject({ personType: 'PF', document: cpf, name: 'Ana Souza', tradeName: null });
    expect(company.schemaName).toBe(`ana_souza_${companyId!.slice(-8)}`);
  });

  it('CNPJ repetido: 409 com mensagem clara, nenhuma empresa nem schema a mais', async () => {
    const cnpj = randomValidCnpj();
    const first = await register(buildRegisterBody({ email: `dup1-${runId}@test.com`, password: PASSWORD, overrides: { document: cnpj } }));
    expect(first.res.status).toBe(201);
    const before = await sys(() => prisma.company.count());
    const second = await register(buildRegisterBody({ email: `dup2-${runId}@test.com`, password: PASSWORD, overrides: { document: cnpj } }));
    expect(second.res.status).toBe(409);
    expect(second.res.body.message).toBe('Já existe uma conta com este CNPJ');
    expect(await sys(() => prisma.company.count())).toBe(before);
  });

  it('PJ sem nome fantasia é recusado com 400', async () => {
    const { res } = await register(
      buildRegisterBody({ email: `nofantasia-${runId}@test.com`, password: PASSWORD, overrides: { tradeName: undefined } }),
    );
    expect(res.status).toBe(400);
  });

  it('empresa com schema no formato antigo tenant_<id> continua roteando', async () => {
    const email = `legacy-${runId}@test.com`;
    const { companyId } = await register(buildRegisterBody({ email, password: PASSWORD, companyName: 'Legada' }));
    const readable = await getTenantSchemaName(prisma, companyId!);
    const legacy = `tenant_${companyId}`;
    // Simula uma empresa anterior à feature: nenhuma requisição autenticada dela rodou ainda, então
    // o cache do resolver está vazio pra ela.
    await sys(() => prisma.$executeRawUnsafe(`ALTER SCHEMA "${readable}" RENAME TO "${legacy}"`));
    await sys(() => prisma.company.update({ where: { id: companyId! }, data: { schemaName: legacy } }));

    const login = await request(app.getHttpServer()).post('/auth/login').set('x-requested-with', 'XMLHttpRequest').send({ email, password: PASSWORD });
    const clientRes = await request(app.getHttpServer())
      .post('/clients').set('Authorization', `Bearer ${login.body.accessToken}`).set('x-requested-with', 'XMLHttpRequest')
      .send({ name: `Cliente Legado ${runId}`, contact: '(11) 90000-0000' });
    expect(clientRes.status).toBe(201);
    await assertRowExistsInTenantSchema(prisma, companyId!, 'Client', { id: clientRes.body.id });
  });

  it('tenant_directory lista empresa, documento, schema e e-mail do fundador', async () => {
    const email = `dir-${runId}@test.com`;
    const cnpj = randomValidCnpj();
    const { companyId } = await register(buildRegisterBody({ email, password: PASSWORD, companyName: 'Diretório Co', overrides: { document: cnpj } }));
    const schemaName = await getTenantSchemaName(prisma, companyId!);
    const rows = await selectBypassingRls<{ empresa: string; documento: string; schema: string; email_admin: string }[]>(
      prisma,
      // Schema-qualificado (não o `FROM tenant_directory` puro do brief) — achado rodando esta
      // suíte: sob PgBouncer em `pool_mode = transaction`, o search_path implícito de uma conexão
      // reciclada nem sempre resolve pra `public` sem qualificação explícita, e toda outra query
      // bruta deste arquivo/suíte já qualifica o schema por precaução (mesmo padrão de
      // tenant-physical-read.util.ts).
      `SELECT empresa, documento, schema, email_admin FROM public.tenant_directory WHERE documento = '${cnpj}'`,
    );
    expect(rows).toEqual([{ empresa: 'Diretório Co', documento: cnpj, schema: schemaName, email_admin: email }]);
  });
});
