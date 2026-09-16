import { PrismaService } from '../src/prisma/prisma.service';
import { runAsSystem } from '../src/prisma/tenant-context';

function sys<T>(fn: () => Promise<T>): Promise<T> {
  return runAsSystem(fn);
}

// `$queryRawUnsafe` never goes through the extension's `$allOperations` hook (by design — see
// tenant-rls.extension.ts), so `runAsSystem()`'s bypass flag alone never reaches Postgres for a raw
// query. Every tenant table (including inside its own physical schema) carries the same
// FORCE ROW LEVEL SECURITY policy as its `public` counterpart, replayed verbatim by the tenant
// migrations — an un-bypassed raw SELECT is silently filtered to zero rows by RLS, indistinguishable
// from "the row isn't there." The bypass `set_config` must be issued in the SAME transaction as the
// raw query. See tenant-routing.e2e-spec.ts for the first occurrence of this fix.
export function selectBypassingRls<T>(prisma: PrismaService, sql: string): Promise<T> {
  return sys(async () => {
    const results = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`,
      prisma.$queryRawUnsafe<T>(sql),
    ]);
    return results[1] as T;
  });
}

function buildWhereClause(where: Record<string, string>): string {
  return Object.entries(where)
    .map(([column, value]) => `"${column}" = '${value.replace(/'/g, "''")}'`)
    .join(' AND ');
}

/** Confirma, com uma leitura SQL direta (não via API/Prisma model), que existe exatamente uma linha
 * dentro do schema físico da empresa — a prova que faltava desde a Fase 1 original: nenhuma suíte
 * anterior consultava `tenant_<id>."Tabela"` diretamente, só confiava em `information_schema`
 * (existência de tabela) ou no comportamento observável da API (que, sozinho, prova isolamento via
 * RLS, não roteamento físico). */
export async function assertRowExistsInTenantSchema(
  prisma: PrismaService,
  companyId: string,
  tableName: string,
  where: Record<string, string>,
): Promise<void> {
  const schemaName = `tenant_${companyId}`;
  const rows = await selectBypassingRls<{ count: bigint }[]>(
    prisma,
    `SELECT count(*) as count FROM "${schemaName}"."${tableName}" WHERE ${buildWhereClause(where)}`,
  );
  const count = Number(rows[0].count);
  if (count !== 1) {
    throw new Error(
      `Esperava exatamente 1 linha em "${schemaName}"."${tableName}" com ${JSON.stringify(where)}, encontrou ${count}`,
    );
  }
}

/** Confirma que a mesma linha NÃO existe em `public` — prova que o dado não "vazou" pro schema
 * compartilhado por engano. */
export async function assertRowAbsentFromPublicSchema(
  prisma: PrismaService,
  tableName: string,
  where: Record<string, string>,
): Promise<void> {
  const rows = await selectBypassingRls<{ count: bigint }[]>(
    prisma,
    `SELECT count(*) as count FROM public."${tableName}" WHERE ${buildWhereClause(where)}`,
  );
  const count = Number(rows[0].count);
  if (count !== 0) {
    throw new Error(`Esperava 0 linhas em public."${tableName}" com ${JSON.stringify(where)}, encontrou ${count}`);
  }
}
