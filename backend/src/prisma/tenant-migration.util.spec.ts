import { PrismaClient } from '@prisma/client';
import { applyMigrations } from './tenant-migration.util';

jest.mock('./migration-files.util', () => ({
  readMigrationSql: (_dir: string, name: string) => `-- sql for ${name}`,
}));

describe('applyMigrations', () => {
  let tx: { $executeRawUnsafe: jest.Mock; tenantMigration: { create: jest.Mock } };

  beforeEach(() => {
    tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(0), tenantMigration: { create: jest.fn() } };
  });

  // Id no formato cuid-like (minúsculo alfanumérico, sem hífen) de propósito — `applyMigrations`
  // valida `schemaName` com o regex estrito de assertValidSchemaName (Task 1), que rejeitaria um
  // valor com hífen.
  const companyId = 'companyabc123456789012345';

  it('executa o SQL de cada migration em ordem contra o schema informado e registra cada uma como aplicada', async () => {
    await applyMigrations(
      tx as unknown as PrismaClient,
      companyId,
      `tenant_${companyId}`,
      '/fake/tenant-migrations',
      ['20260101000000_a', '20260102000000_b'],
    );

    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(1, '-- sql for 20260101000000_a');
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(2, '-- sql for 20260102000000_b');
    expect(tx.tenantMigration.create).toHaveBeenNthCalledWith(1, {
      data: { companyId, migrationName: '20260101000000_a' },
    });
    expect(tx.tenantMigration.create).toHaveBeenNthCalledWith(2, {
      data: { companyId, migrationName: '20260102000000_b' },
    });
  });

  it('rejeita um nome de schema inválido antes de rodar qualquer SQL', async () => {
    await expect(
      applyMigrations(tx as unknown as PrismaClient, companyId, 'tenant_abc"; DROP TABLE x; --', '/fake', []),
    ).rejects.toThrow();
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  // Regressão: descoberto no teste de integração real (Step 8) desta task, não no brief — Postgres
  // rejeita múltiplos comandos num único `$executeRawUnsafe` (SQLSTATE 42601), e toda migration
  // real deste projeto tem várias declarações separadas por `;`. Este teste força um
  // `readMigrationSql` mockado com SQL multi-statement (incluindo um `;` dentro de uma string
  // literal, que NÃO pode virar um corte) e confirma que cada declaração de nível superior vira uma
  // chamada separada, na ordem certa, e que `tenantMigration.create` ainda é chamado só uma vez por
  // migration (não uma vez por statement).
  it('divide uma migration com múltiplas declarações SQL em uma chamada por declaração, sem cortar um ";" dentro de string literal', async () => {
    jest.resetModules();
    jest.doMock('./migration-files.util', () => ({
      readMigrationSql: () =>
        `CREATE TABLE "A" ("id" TEXT NOT NULL);\nCREATE TABLE "B" ("note" TEXT DEFAULT 'a;b');\n`,
    }));
    const { applyMigrations: applyMigrationsWithMultiStatement } = await import('./tenant-migration.util');

    await applyMigrationsWithMultiStatement(
      tx as unknown as PrismaClient,
      companyId,
      `tenant_${companyId}`,
      '/fake/tenant-migrations',
      ['20260101000000_multi'],
    );

    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(1, 'CREATE TABLE "A" ("id" TEXT NOT NULL)');
    expect(tx.$executeRawUnsafe).toHaveBeenNthCalledWith(2, `CREATE TABLE "B" ("note" TEXT DEFAULT 'a;b')`);
    expect(tx.tenantMigration.create).toHaveBeenCalledTimes(1);
    expect(tx.tenantMigration.create).toHaveBeenCalledWith({
      data: { companyId, migrationName: '20260101000000_multi' },
    });

    jest.dontMock('./migration-files.util');
    jest.resetModules();
  });
});
