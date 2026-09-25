import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FriendlyThrottlerGuard } from '../src/auth/guards/friendly-throttler.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';
import { selectBypassingRls } from './tenant-physical-read.util';
import { buildRegisterBody } from './register-body.util';
import { getTenantSchemaName } from './tenant-schema-name.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// Número de empresas REAIS registradas neste teste — não simulado, cada uma passa pelo
// provisionamento transacional completo (CREATE SCHEMA + réplica de 18 migrations).
const COMPANY_COUNT = 30;
// Requisições concorrentes por empresa, disparadas em paralelo de verdade (Promise.all, não em
// sequência) — simula várias pessoas da mesma empresa usando o sistema ao mesmo tempo.
const CONCURRENT_REQUESTS_PER_COMPANY = 5;

describe('Teste de stress — múltiplas empresas reais, concorrência real (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const companyIds: string[] = [];
  const schemaNames = new Map<string, string>();
  const runId = Date.now();

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    // POST /auth/register é limitado a 5 requisições/15min por IP (FriendlyThrottlerGuard,
    // auth.controller.ts) — uma proteção real contra abuso, correta em produção, mas que a 6ª das
    // 30 requisições sequenciais de registro abaixo (todas do mesmo IP de teste) estouraria sem
    // esta sobrescrita. Este teste mede capacidade de conexão/roteamento sob concorrência, não
    // rate limiting (já coberto em auth/login-rate-limit.spec.ts) — desligar aqui isola o que
    // realmente está sendo medido. Achado ao migrar esta suíte pro novo corpo de registro (Task 6,
    // 25/09/2026): a sobrescrita só cobria `ThrottlerGuard`, mas a rota usa `FriendlyThrottlerGuard`
    // (subclasse própria, token de DI diferente, desde 18/09/2026) — nunca teve efeito nenhum, só
    // nunca foi percebido porque o corpo antigo de registro já quebrava com 400 na 1ª chamada, antes
    // de qualquer teste chegar a fazer 6 chamadas de verdade. Sobrescrevendo os dois tokens agora.
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
  }, 120_000);

  afterAll(async () => {
    for (const companyId of companyIds) {
      const schemaName = schemaNames.get(companyId)!;
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  }, 60_000);

  it(`registra ${COMPANY_COUNT} empresas reais e faz ${CONCURRENT_REQUESTS_PER_COMPANY} requisições concorrentes por empresa sem erro`, async () => {
    const tokens: string[] = [];
    for (let i = 0; i < COMPANY_COUNT; i++) {
      const email = `stress-${runId}-${i}@test.com`;
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .set('x-requested-with', 'XMLHttpRequest')
        .send(buildRegisterBody({ companyName: `Stress Co ${i}`, email, password: 'senha-de-teste-12345' }))
        .expect(201);
      tokens.push(`Bearer ${registerRes.body.accessToken}`);
      const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
      companyIds.push(user.companyId);
      schemaNames.set(user.companyId, await getTenantSchemaName(prisma, user.companyId));
    }

    const startedAt = Date.now();
    const allRequests = tokens.flatMap((token, companyIndex) =>
      Array.from({ length: CONCURRENT_REQUESTS_PER_COMPANY }, (_, reqIndex) =>
        request(app.getHttpServer())
          .post('/clients')
          .set('Authorization', token)
          .send({ name: `Cliente Stress ${companyIndex}-${reqIndex}`, contact: '(11) 90000-0000' }),
      ),
    );
    const results = await Promise.all(allRequests);
    const durationMs = Date.now() - startedAt;

    const failures = results.filter((r) => r.status !== 201);
    // eslint-disable-next-line no-console
    console.log(
      `[stress] ${COMPANY_COUNT} empresas × ${CONCURRENT_REQUESTS_PER_COMPANY} requisições concorrentes = ` +
        `${allRequests.length} requisições em ${durationMs}ms, ${failures.length} falhas.`,
    );
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.log('[stress] exemplos de falha:', failures.slice(0, 3).map((f) => ({ status: f.status, body: f.body })));
    }

    expect(failures).toHaveLength(0);

    // Confirma que cada Cliente criado sob concorrência está fisicamente no schema certo — sob
    // stress é exatamente onde um bug de roteamento cruzado entre empresas apareceria.
    for (let companyIndex = 0; companyIndex < COMPANY_COUNT; companyIndex++) {
      const companyId = companyIds[companyIndex];
      const schemaName = schemaNames.get(companyId)!;
      const rows = await selectBypassingRls<{ count: bigint }[]>(
        prisma,
        `SELECT count(*) as count FROM "${schemaName}"."Client" WHERE name LIKE 'Cliente Stress ${companyIndex}-%'`,
      );
      expect(Number(rows[0].count)).toBe(CONCURRENT_REQUESTS_PER_COMPANY);
    }
  }, 300_000);
});
