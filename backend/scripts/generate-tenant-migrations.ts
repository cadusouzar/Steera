import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { listMigrationNames, readMigrationSql } from '../src/prisma/migration-files.util';
import { TENANT_TABLE_NAMES } from '../src/prisma/tenant-table-names';

const MAIN_MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');
const TENANT_MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'tenant-migrations');

// Classifica cada comando SQL de uma migration como "de uma tabela de tenant" (mantido) ou "de uma
// tabela central" (removido). Olha só pra tabela PRINCIPAL de cada comando (a que está sendo
// criada/alterada/indexada) — uma referência de FK a uma tabela central dentro de um comando de
// tabela de tenant é sempre mantida junto (o search_path resolve essa referência corretamente
// contra o schema central via fallthrough, é uma FK cross-schema válida no PostgreSQL).
export function splitMigrationSqlByTenant(sql: string, tenantTableNames: readonly string[]): string {
  const isTenantTable = (name: string) => tenantTableNames.includes(name);

  // Remove TODA linha de comentário (`--...`) do texto INTEIRO antes de dividir em statements —
  // não basta filtrar um "statement" cujo texto inteiro comece com `--`, porque várias migrations
  // deste projeto têm um bloco de comentário de várias linhas colado, sem linha em branco, direto
  // em cima do comando SQL real (ex.: a migration de RLS) — dividir ANTES de remover comentários
  // juntaria o comentário e o comando na mesma "statement", e o regex de classificação (que casa
  // só no INÍCIO da string) nunca reconheceria o comando real logo depois do comentário.
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements = withoutComments
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.endsWith(';') ? s : `${s};`));

  const kept: string[] = [];

  for (const statement of statements) {
    // CREATE TYPE (enum) — sempre mantido. Um enum não usado por nenhuma tabela do schema do
    // tenant é inofensivo lá dentro (diferente de uma tabela, um tipo não é "resolvido via
    // search_path" de um jeito que crie ambiguidade com dado real) — não vale a complexidade de
    // mapear qual enum pertence a qual tabela.
    if (/^CREATE TYPE\s+"\w+"/i.test(statement)) {
      kept.push(statement);
      continue;
    }

    const tableMatch =
      statement.match(/^CREATE TABLE\s+"(\w+)"/i) ||
      statement.match(/^ALTER TABLE\s+"(\w+)"/i) ||
      statement.match(/^CREATE(?:\s+UNIQUE)?\s+INDEX\s+"[^"]+"\s+ON\s+"(\w+)"/i) ||
      statement.match(/^CREATE POLICY\s+\S+\s+ON\s+"(\w+)"/i) ||
      statement.match(/^DROP INDEX\s+"(\w+?)_/i) ||
      statement.match(/^UPDATE\s+"(\w+)"/i);

    if (tableMatch) {
      if (isTenantTable(tableMatch[1])) kept.push(statement);
      continue;
    }

    // Não bate com nenhum padrão conhecido — mantém por segurança (excluir algo necessário
    // silenciosamente é pior do que incluir algo supérfluo), mas avisa alto no console pra quem
    // rodar o gerador notar e revisar manualmente antes de commitar.
    // eslint-disable-next-line no-console
    console.warn(`[generate-tenant-migrations] comando não classificado, mantido por padrão: ${statement}`);
    kept.push(statement);
  }

  return kept.join('\n\n');
}

function main() {
  rmSync(TENANT_MIGRATIONS_DIR, { recursive: true, force: true });
  mkdirSync(TENANT_MIGRATIONS_DIR, { recursive: true });

  const migrationNames = listMigrationNames(MAIN_MIGRATIONS_DIR);
  for (const name of migrationNames) {
    const sql = readMigrationSql(MAIN_MIGRATIONS_DIR, name);
    const filtered = splitMigrationSqlByTenant(sql, TENANT_TABLE_NAMES);
    if (filtered.trim().length === 0) continue; // migration inteira era central — nenhum arquivo gerado pra ela
    const dir = join(TENANT_MIGRATIONS_DIR, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'migration.sql'), `${filtered}\n`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Geradas ${readdirSync(TENANT_MIGRATIONS_DIR).length} migrations de tenant em ${TENANT_MIGRATIONS_DIR} — revise o \`git diff\` antes de commitar.`,
  );
}

if (require.main === module) {
  main();
}
