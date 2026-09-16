import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { applyMigrations } from '../src/prisma/tenant-migration.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem, runWithTenant } from '../src/prisma/tenant-context';
import { runTenantInteractiveTransaction } from '../src/prisma/tenant-rls.extension';
import { selectBypassingRls } from './tenant-physical-read.util';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// Achado na revisão final do routing fix (I1): `applyMigrations`'s bookkeeping write
// (`TenantMigration`, tabela central) rodava através de `tx` sem saber se `tx` era o client
// CENTRAL (AuthService.register, onde sempre funcionou) ou um client de TENANT já resolvido
// (TenantMigrationManagerService's catch-up, via `runTenantInteractiveTransaction`) — nesse
// segundo caso, a API de modelo do Prisma compilaria a escrita contra `tenant_<id>`, onde
// `TenantMigration` não existe (é deliberadamente central). Isso nunca disparava na prática porque
// nenhuma migration nova tinha sido adicionada desde que a Fase 1 lançou (toda empresa provisionada
// já nasce com tudo aplicado) — mas dispararia na primeira vez que alguém adicionasse uma migration
// nova. Corrigido: a escrita de bookkeeping agora é SQL bruto, explicitamente schema-qualificado
// pra `public`, dentro da mesma transação do DDL — funciona não importa qual client físico está
// rodando o replay. Este teste exercita o caminho de catch-up de verdade (via
// `runTenantInteractiveTransaction` com o registry real de produção, resolvendo pro client de
// tenant da empresa), não o de provisionamento novo (que sempre funcionou e não provaria nada
// sobre este achado).
describe('Catch-up de migration de tenant: bookkeeping sempre cai em public.TenantMigration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let tempMigrationsDir: string;

  const runId = Date.now();
  const email = `migration-catchup-${runId}@test.com`;
  const fakeMigrationName = `${runId}000000_synthetic_catchup_test`;

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
      .send({ companyName: 'Migration Catchup Co', email, password: 'senha-de-teste-12345' })
      .expect(201);
    void registerRes;
    const user = await sys(() => prisma.user.findUniqueOrThrow({ where: { email } }));
    companyId = user.companyId;

    // Uma migration sintética, idempotente e segura — nunca uma das reais deste projeto, que já
    // foram todas aplicadas no registro acima e não podem ser reaplicadas sem erro.
    tempMigrationsDir = mkdtempSync(join(tmpdir(), 'tenant-catchup-test-'));
    mkdirSync(join(tempMigrationsDir, fakeMigrationName));
    writeFileSync(
      join(tempMigrationsDir, fakeMigrationName, 'migration.sql'),
      'CREATE TABLE IF NOT EXISTS "_bookkeeping_catchup_test" (id text);',
    );
  });

  afterAll(async () => {
    rmSync(tempMigrationsDir, { recursive: true, force: true });
    const schemaName = `tenant_${companyId}`;
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId } }));
    await sys(() => prisma.company.delete({ where: { id: companyId } }));
    await app.close();
  });

  it('applyMigrations, chamado via runTenantInteractiveTransaction (o mesmo caminho do catch-up real), grava o bookkeeping em public.TenantMigration, nunca no schema do tenant', async () => {
    const schemaName = `tenant_${companyId}`;

    // Mesmo caminho exato que TenantMigrationManagerService.applyPendingMigrationsToAllTenants usa:
    // contexto de tenant real (runWithTenant) + runTenantInteractiveTransaction, resolvendo pro
    // client de tenant real via o registry de produção (registrado por prisma.module.ts).
    await runWithTenant(companyId, () =>
      runTenantInteractiveTransaction(prisma, async (tx) => {
        await applyMigrations(tx, companyId, schemaName, tempMigrationsDir, [fakeMigrationName]);
      }),
    );

    const [bookkeepingRow] = await selectBypassingRls<{ migrationName: string }[]>(
      prisma,
      `SELECT "migrationName" FROM public."TenantMigration" WHERE "companyId" = '${companyId}' AND "migrationName" = '${fakeMigrationName}'`,
    );
    expect(bookkeepingRow).toBeDefined();

    // A tabela TenantMigration é central — nunca existe fisicamente dentro de um schema de tenant.
    await expect(
      selectBypassingRls(prisma, `SELECT 1 FROM "${schemaName}"."TenantMigration" LIMIT 1`),
    ).rejects.toThrow();

    // O DDL sintético em si rodou corretamente contra o schema do TENANT (prova que o roteamento
    // físico da Task 3 continua funcionando pra este caminho).
    const [ddlProof] = await selectBypassingRls<{ table_name: string }[]>(
      prisma,
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schemaName}' AND table_name = '_bookkeeping_catchup_test'`,
    );
    expect(ddlProof).toBeDefined();
  });
});
