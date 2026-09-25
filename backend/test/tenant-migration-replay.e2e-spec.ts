import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { listMigrationNames } from '../src/prisma/migration-files.util';
import { applyMigrations } from '../src/prisma/tenant-migration.util';

const TENANT_MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'tenant-migrations');

describe('applyMigrations (integration — Postgres real)', () => {
  const prisma = new PrismaClient();
  // Desvio deliberado do literal do brief (`tenant_test${Date.now()}`.slice(0, 30)`): a parte
  // depois de "tenant_" nesse template tem só 17 caracteres (4 de "test" + 13 de Date.now()), mas
  // o regex de assertValidSchemaName (Task 1) exige 20-30 — o schema seria rejeitado antes de
  // qualquer SQL rodar (confirmado ao rodar o teste literal do brief). Complementado com 4 chars
  // hex aleatórios (17 + 4 = 21, dentro da faixa exigida) pra manter o nome único e descartável.
  const schemaName = `tenant_test${Date.now()}${randomBytes(2).toString('hex')}`;
  let companyId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    // `schemaName` é @unique e obrigatório desde a feature de cadastro ampliado/schema legível
    // (25/09/2026) — esta suíte já cria/repassa migrations/dropa um schema físico próprio
    // (`schemaName`, computado acima), então a Company criada aqui precisa apontar pra ESSE MESMO
    // nome, não um valor arbitrário: é o schema que `applyMigrations` de fato replica e que o
    // `afterAll` dropa.
    const company = await prisma.company.create({ data: { name: 'Migration Replay Test Co', schemaName } });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await prisma.tenantMigration.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('replica todo o histórico de migrations de tenant contra um schema novo, sem criar Company/User/RefreshToken lá dentro', async () => {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    const migrationNames = listMigrationNames(TENANT_MIGRATIONS_DIR);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
      await applyMigrations(tx, companyId, schemaName, TENANT_MIGRATIONS_DIR, migrationNames);
    });

    const tables = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schemaName}'`,
    );
    const tableNames = tables.map((t) => t.table_name);
    expect(tableNames).toEqual(expect.arrayContaining(['Client', 'Employee', 'TimeEvent', 'WorkSchedule']));
    expect(tableNames).not.toEqual(expect.arrayContaining(['Company', 'User', 'RefreshToken', 'TenantMigration']));

    const applied = await prisma.tenantMigration.findMany({ where: { companyId } });
    expect(applied.length).toBe(migrationNames.length);
  });
});
