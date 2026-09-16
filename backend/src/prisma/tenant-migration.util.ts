import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { assertValidSchemaName } from './tenant-schema.util';
import { readMigrationSql } from './migration-files.util';

// Descoberto rodando o teste de integração real do Step 8 desta task (não previsto no brief nem
// na spec — `$executeRawUnsafe(sql)` com o `migration.sql` inteiro, como escrito originalmente):
// o protocolo estendido do Postgres (o que o driver do Prisma usa) rejeita múltiplos comandos num
// único statement preparado ("não é possível inserir múltiplos comandos no comando preparado",
// SQLSTATE 42601) — e TODA migration real deste projeto tem várias declarações (`CREATE TABLE`
// + `CREATE INDEX` + `ALTER TABLE ... ADD CONSTRAINT`, etc.), então a versão de uma chamada só por
// arquivo nunca funcionaria contra Postgres de verdade. Corrigido dividindo o texto em statements
// individuais antes de executar cada um — mantém exatamente o mesmo comportamento observável pro
// teste mockado do Step 4 (a string mockada `-- sql for <nome>` não tem nenhum `;`, então vira um
// único statement, idêntico ao texto original) e passa a funcionar contra os 20 arquivos reais de
// `prisma/tenant-migrations/`. O splitter respeita aspas simples/duplas e blocos `$tag$...$tag$`
// (nenhuma migration deste projeto usa isso hoje, mas uma função/trigger futura usaria) pra nunca
// cortar um `;` que esteja dentro de uma string ou corpo de função.
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (sql.startsWith('*/', i)) {
        current += '*/';
        i += 2;
        inBlockComment = false;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i++;
      continue;
    }
    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        current += sql[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") inSingleQuote = false;
      i++;
      continue;
    }
    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') inDoubleQuote = false;
      i++;
      continue;
    }

    if (sql.startsWith('--', i)) {
      inLineComment = true;
      current += '--';
      i += 2;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      inBlockComment = true;
      current += '/*';
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '$') {
      const match = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim().length > 0) statements.push(current);

  return statements.map((s) => s.trim()).filter((s) => s.length > 0);
}

// Reaproveitada por dois chamadores: provisionamento de empresa nova (Task 7, com a lista
// COMPLETA de migrations de tenant) e o catch-up de empresas existentes (Task 8, só com as
// PENDENTES) — a única diferença entre os dois casos é o conteúdo de `migrationNames`.
//
// IMPORTANTE: quem chama esta função já precisa ter rodado `SET LOCAL search_path TO
// "<schemaName>", public` antes (ver Tasks 7/8) — esta função não define o search_path sozinha,
// porque ela roda como parte de uma transação maior que o chamador já controla, e definir o
// search_path aqui dentro criaria uma segunda mini-transação implícita que quebraria a atomicidade
// da transação externa (mesma armadilha já documentada em tenant-rls.extension.ts pra
// `insideExplicitTx`).
export async function applyMigrations(
  tx: PrismaClient | Prisma.TransactionClient,
  companyId: string,
  schemaName: string,
  tenantMigrationsDir: string,
  migrationNames: string[],
): Promise<void> {
  assertValidSchemaName(schemaName);
  for (const migrationName of migrationNames) {
    const sql = readMigrationSql(tenantMigrationsDir, migrationName);
    for (const statement of splitSqlStatements(sql)) {
      await tx.$executeRawUnsafe(statement);
    }
    // Achado na revisão final do routing fix: `tx.tenantMigration.create(...)` (API de modelo)
    // dependia de `tx` resolver contra o schema CENTRAL — verdade quando o chamador é
    // AuthService.register (bypass, sempre central), mas não quando o chamador é
    // TenantMigrationManagerService's catch-up (Task 8 do plano original), onde `tx` vem de um
    // client de TENANT já resolvido (routing fix, Task 3) — nesse caso a API de modelo compilaria
    // a query contra `tenant_<id>`, onde `TenantMigration` não existe (é deliberadamente central,
    // fora de `TENANT_TABLE_NAMES`). SQL bruto, schema-qualificado explicitamente pra `public`,
    // funciona nos dois casos (schema-qualificação explícita ignora o search_path/schema da conexão
    // por completo) e mantém o registro de bookkeeping na MESMA transação que o DDL — atomicidade
    // preservada, sem depender de qual client físico está rodando o replay.
    await tx.$executeRawUnsafe(
      'INSERT INTO public."TenantMigration" (id, "companyId", "migrationName", "appliedAt") VALUES ($1, $2, $3, now())',
      randomUUID(),
      companyId,
      migrationName,
    );
  }
}
