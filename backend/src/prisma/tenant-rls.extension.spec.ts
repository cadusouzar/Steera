// `Prisma.defineExtension({...})` (real @prisma/client, v5.22) does NOT return the definition
// object unchanged — it returns an opaque "reusable extension" function that only yields the
// definition's shape once applied via `client.$extends(...)` against a real query engine. That
// makes the `$allOperations` hook unreachable for a plain unit test. This mock replaces
// `Prisma.defineExtension` with the identity function so the tests below can inspect the
// definition object (`ext.query.$allModels.$allOperations`) directly, exactly like the rest of
// this file's production code still calls the real `Prisma.defineExtension` — only this test
// file's module registry is affected.
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    Prisma: {
      ...actual.Prisma,
      defineExtension: (definition: unknown) => definition,
    },
  };
});

import { runAsSystem, runWithTenant } from './tenant-context';
import { tenantRlsExtension } from './tenant-rls.extension';

describe('tenantRlsExtension — search_path', () => {
  it('define SET LOCAL search_path pro schema do tenant, além do set_config já existente', async () => {
    const executedRawUnsafe: string[] = [];
    const base = {
      $executeRaw: jest.fn(() => 'set-config-stmt'),
      $executeRawUnsafe: jest.fn((sql: string) => {
        executedRawUnsafe.push(sql);
        return 'search-path-stmt';
      }),
      $transaction: jest.fn(async (stmts: unknown[]) => stmts.map((_s, i) => (i === stmts.length - 1 ? 'query-result' : null))),
    };
    const ext = tenantRlsExtension(base as any);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    // Id no formato cuid-like (minúsculo alfanumérico, sem hífen) — assertValidSchemaName (Task 1)
    // rejeitaria um valor com hífen antes mesmo de chegar no $executeRawUnsafe.
    const result = await runWithTenant('companyabc123456789012345', () =>
      allOperations({ args: {}, query: async () => 'query-result' }),
    );

    expect(result).toBe('query-result');
    expect(executedRawUnsafe[0]).toBe('SET LOCAL search_path TO "tenant_companyabc123456789012345", public');
    expect(base.$transaction).toHaveBeenCalledWith(['search-path-stmt', 'set-config-stmt', expect.any(Promise)]);
  });

  it('não define search_path em modo bypass (login/register/refresh pré-autenticação)', async () => {
    const executedRawUnsafe: string[] = [];
    const base = {
      $executeRaw: jest.fn(() => 'set-config-bypass-stmt'),
      $executeRawUnsafe: jest.fn((sql: string) => { executedRawUnsafe.push(sql); return sql; }),
      $transaction: jest.fn(async (stmts: unknown[]) => stmts.map((_s, i) => (i === stmts.length - 1 ? 'query-result' : null))),
    };
    const ext = tenantRlsExtension(base as any);
    const allOperations = (ext as any).query.$allModels.$allOperations;

    await runAsSystem(() => allOperations({ args: {}, query: async () => 'query-result' }));

    expect(executedRawUnsafe).toEqual([]);
    expect(base.$transaction).toHaveBeenCalledWith(['set-config-bypass-stmt', expect.any(Promise)]);
  });
});
