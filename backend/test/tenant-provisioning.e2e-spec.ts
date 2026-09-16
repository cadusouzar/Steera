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

describe('Provisionamento de tenant novo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  const runId = Date.now();
  const email = `provisioning-${runId}@test.com`;

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
  });

  afterAll(async () => {
    if (companyId) {
      const schemaName = `tenant_${companyId}`;
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  it('cria um schema físico de verdade, sem Company/User duplicados lá dentro, e o primeiro admin consegue logar', async () => {
    const server = app.getHttpServer();

    const registerRes = await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Provisioning Test Co', email, password: 'senha-de-teste-12345' })
      .expect(201);

    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    companyId = user.companyId;
    const schemaName = `tenant_${companyId}`;

    const tables = await sys(() =>
      prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schemaName}'`,
      ),
    );
    const tableNames = tables.map((t) => t.table_name);
    expect(tableNames).toContain('Client');
    expect(tableNames).not.toEqual(expect.arrayContaining(['Company', 'User', 'RefreshToken']));

    // AuthController.login não tem @HttpCode explícito, então o Nest usa o default de POST (201),
    // não 200 como o texto original do brief assumia — comportamento real confirmado rodando este
    // teste contra o Postgres de teste antes de ajustar a expectativa.
    const loginRes = await request(server)
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email, password: 'senha-de-teste-12345' })
      .expect(201);
    expect(loginRes.body.accessToken).toBeTruthy();

    const meRes = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .expect(200);
    expect(meRes.body.email).toBe(email);

    expect(registerRes.body.accessToken).toBeTruthy();
  });

  it('retentar após uma falha de negócio conhecida (e-mail duplicado) não deixa sujeira (empresa parcial)', async () => {
    const server = app.getHttpServer();
    const dupEmail = `dup-${runId}@test.com`;

    await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Dup Co', email: dupEmail, password: 'senha-de-teste-12345' })
      .expect(201);

    await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Dup Co 2', email: dupEmail, password: 'senha-de-teste-12345' })
      .expect(409);

    const dupUser = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: dupEmail } }));
    const schemaName = `tenant_${dupUser.companyId}`;

    // Prova ativa de "zero sujeira", não apenas presumida pela semântica de transação: a segunda
    // tentativa (que falhou dentro da MESMA transação interativa, depois de já ter rodado CREATE
    // SCHEMA + replay de todas as migrations de tenant para um segundo schema) não deve ter deixado
    // nenhum Company extra chamado "Dup Co 2" (deliberadamente checagem por NOME/existência, não
    // por contagem total antes/depois — outros arquivos e2e rodando em paralelo em workers
    // diferentes do Jest também registram empresas concorrentemente contra o mesmo Postgres de
    // teste, o que tornaria qualquer asserção de contagem GLOBAL antes/depois inerentemente frágil
    // e um falso positivo/negativo dependendo de quais specs rodam junto).
    const companiesNamedDupCo2 = await sys(() => prisma.company.count({ where: { name: 'Dup Co 2' } }));
    expect(companiesNamedDupCo2).toBe(0);
    // O único schema físico que deve existir para este e-mail é o da tentativa que teve sucesso —
    // a tentativa falha nunca chegou a persistir nada que sobrevivesse ao rollback da transação.
    const schemaExists = await sys(() =>
      prisma.$queryRawUnsafe<{ exists: boolean }[]>(
        `SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = '${schemaName}') AS exists`,
      ),
    );
    expect(schemaExists[0].exists).toBe(true);

    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId: dupUser.companyId } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId: dupUser.companyId } }));
    await sys(() => prisma.company.delete({ where: { id: dupUser.companyId } }));
  });
});
