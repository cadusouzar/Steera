import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { listMigrationNames, readMigrationSql } from '../src/prisma/migration-files.util';
import { TENANT_TABLE_NAMES } from '../src/prisma/tenant-table-names';

const MAIN_MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');
const TENANT_MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'tenant-migrations');

// Migrations de REMEDIAÇÃO de um incidente real no banco compartilhado de dev (um
// `db push --accept-data-loss` acidental apagou colunas que uma migration ANTERIOR já tinha
// criado — ver o comentário de cada arquivo original pra o relato completo do incidente). Cada uma
// só re-adiciona algo que uma migration mais antiga NA MESMA sequência já criou — perfeitamente
// correto pra "consertar" o banco real que sofreu o incidente (que nunca teve seu
// `_prisma_migrations` alterado, então o Prisma nunca soube que precisava reaplicar nada sozinho),
// mas redundante — e por isso um erro de "coluna já existe" — quando replicado do zero contra um
// schema de tenant novo, que nunca passou pelo incidente e já tem a coluna certa desde a migration
// original. Achado ao rodar de verdade o replay completo contra um schema descartável (Task 4) —
// nenhuma migration futura deve precisar entrar nesta lista a menos que sofra o mesmíssimo padrão
// (remediar um incidente específico do banco real, não uma mudança de schema genuína).
export const NOOP_WHEN_REPLAYED_FROM_EMPTY = [
  '20260911003303_restore_client_trash_columns',
  '20260911003700_restore_receivable_subscription_link',
];

// Enums usados só por tabelas CENTRAIS (nunca por nenhuma tabela de tenant) — achado em
// 17/09/2026 ao gerar a migration que adiciona valores a `AppModule`/`UserStatus` (ambos usados só
// por `User`): `ALTER TYPE ... ADD VALUE` não batia em nenhum padrão do classificador abaixo, então
// caía no branch "mantém por segurança" — só que, ao contrário de `CREATE TYPE` (sempre inofensivo
// num schema de tenant, porque cria um tipo novo e sem uso), um `ALTER TYPE` mantido tentaria
// adicionar o MESMO valor de novo no MESMO tipo compartilhado/global (`public."AppModule"`, nunca
// duplicado por tenant) toda vez que uma empresa nova fosse provisionada depois da primeira — a
// segunda empresa pra frente quebraria com "enum label already exists" e a transação de
// provisionamento inteira sofreria rollback. Mantida como lista manual (mesmo padrão de
// `NOOP_WHEN_REPLAYED_FROM_EMPTY`) porque o gerador só processa texto SQL, sem saber quais enums
// pertencem a quais models — cada enum novo genuinamente central precisa ser adicionado aqui à mão.
// CompanyPlanTier (26/09/2026) — usado só por `Company`, tabela central — entrou nesta lista pelo
// mesmo motivo de AppModule/UserStatus: a migration que adiciona GRATIS ao enum é um `ALTER TYPE`
// contra um tipo global único, e replayá-la de novo em cada empresa provisionada depois da primeira
// quebraria com "enum label already exists".
// UserTokenType (26/09/2026) — usado só por `UserToken`, tabela central nova (token de uso único
// de confirmação/convite/redefinição de senha) — mesmo motivo das demais: sem uso nenhum em
// tabela de tenant, não precisa (nem deve) ser replicado no histórico de tenant-migrations.
export const CENTRAL_ONLY_ENUM_NAMES = ['AppModule', 'UserStatus', 'CompanyPlanTier', 'UserTokenType'];

// Views que existem só sobre tabelas CENTRAIS (nunca sobre nenhuma tabela de tenant) — achado em
// 25/09/2026 ao gerar a migration que cria `tenant_directory` (lê "Company"/"User", as duas
// centrais): `CREATE VIEW`/`DROP VIEW` não batiam em nenhum padrão do classificador abaixo, caindo
// no branch "mantém por segurança com aviso". Diferente de `CREATE TYPE` (sempre inofensivo, cria um
// tipo novo sem uso), replayar `CREATE VIEW "tenant_directory"` dentro de um schema de tenant
// funcionaria (o search_path resolve "Company"/"User" via fallthrough pro `public`), mas daria a
// CADA empresa sua própria cópia da MESMA view listando TODAS as empresas do sistema — o oposto do
// que ela existe pra fazer (um diretório único, central, pro N1/dev; "Company" não tem RLS). Mesma
// lista manual de `CENTRAL_ONLY_ENUM_NAMES`, pelo mesmo motivo: o gerador só processa texto SQL, sem
// saber quais views pertencem a quais tabelas — cada view nova genuinamente central precisa entrar
// aqui à mão.
export const CENTRAL_ONLY_VIEW_NAMES = ['tenant_directory'];

// Funções que existem só pra objetos CENTRAIS — achado em 25/09/2026 com a trigger que impede
// alterar `Company.schemaName` depois do cadastro. Replayar `CREATE FUNCTION` num schema de tenant
// criaria uma cópia inútil da função em cada empresa (a `CREATE TRIGGER` correspondente, em
// "Company", já é descartada pela classificação por tabela). Mesma lista manual das outras acima.
export const CENTRAL_ONLY_FUNCTION_NAMES = ['company_schema_name_immutable'];

// Divide o SQL de uma migration em statements num `;` seguido de quebra de linha — o mesmo critério
// de sempre — mas NUNCA dentro de um bloco dollar-quoted (`$$ ... $$` ou `$tag$ ... $tag$`): o corpo
// de uma função plpgsql tem vários `;` + quebra de linha que não encerram o comando. Antes disto, o
// split por regex cortava a função em pedaços, cada um caindo no branch "não classificado, mantido
// por padrão" — SQL quebrado replicado em cada schema de tenant.
// Limitação conhecida: strings entre aspas simples não são tratadas (nenhuma migration do projeto
// tem `;` + quebra de linha ou `$` dentro de uma string literal).
export function splitSqlStatements(sql: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  let i = 0;
  let dollarTag: string | null = null;
  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
      } else {
        i++;
      }
      continue;
    }
    if (sql[i] === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        dollarTag = tag[0];
        i += tag[0].length;
        continue;
      }
    }
    if (sql[i] === ';') {
      const terminator = /^;\s*\n/.exec(sql.slice(i));
      if (terminator) {
        pieces.push(sql.slice(start, i));
        i += terminator[0].length;
        start = i;
        continue;
      }
    }
    i++;
  }
  pieces.push(sql.slice(start));
  return pieces
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.endsWith(';') ? s : `${s};`));
}

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

  const statements = splitSqlStatements(withoutComments);

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

    const alterTypeMatch = statement.match(/^ALTER TYPE\s+"(\w+)"/i);
    if (alterTypeMatch) {
      if (!CENTRAL_ONLY_ENUM_NAMES.includes(alterTypeMatch[1])) kept.push(statement);
      continue;
    }

    // CREATE [OR REPLACE] VIEW / ALTER VIEW / DROP VIEW [IF EXISTS] — só removido quando o nome está
    // na lista manual `CENTRAL_ONLY_VIEW_NAMES` (ver comentário lá). Uma view não listada é mantida
    // (mesmo espírito conservador do branch "desconhecido" abaixo, só que já classificado — sem aviso).
    const viewMatch =
      statement.match(/^CREATE(?:\s+OR\s+REPLACE)?\s+VIEW\s+"(\w+)"/i) ||
      statement.match(/^ALTER VIEW\s+(?:IF EXISTS\s+)?"(\w+)"/i) ||
      statement.match(/^DROP VIEW\s+(?:IF EXISTS\s+)?"(\w+)"/i);
    if (viewMatch) {
      if (!CENTRAL_ONLY_VIEW_NAMES.includes(viewMatch[1])) kept.push(statement);
      continue;
    }

    // CREATE [OR REPLACE] FUNCTION / DROP FUNCTION [IF EXISTS] — mesma regra das views: só removida
    // quando o nome está em `CENTRAL_ONLY_FUNCTION_NAMES`; o corpo inteiro chega aqui como um único
    // statement (ver splitSqlStatements).
    const functionMatch =
      statement.match(/^CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+"?(\w+)"?/i) ||
      statement.match(/^DROP FUNCTION\s+(?:IF EXISTS\s+)?"?(\w+)"?/i);
    if (functionMatch) {
      if (!CENTRAL_ONLY_FUNCTION_NAMES.includes(functionMatch[1])) kept.push(statement);
      continue;
    }

    // SELECT set_config('app.rls_bypass', ...) — achado em 17/09/2026 junto do bug real que essa
    // flag existe pra evitar (uma migration de dados numa tabela CENTRAL com FORCE RLS precisa dela
    // pra não virar um no-op silencioso). Sempre um setup de sessão pra autorizar as escritas em
    // tabela CENTRAL que vêm em seguida NA MESMA migration — nunca faz sentido sozinho num schema de
    // tenant, cujo contexto de empresa já vem setado pela própria transação de provisionamento
    // (`AuthService.register()`), então é sempre descartado aqui, sem exigir revisão manual.
    if (/^SELECT set_config\('app\.rls_bypass'/i.test(statement)) {
      continue;
    }

    const tableMatch =
      statement.match(/^CREATE TABLE\s+"(\w+)"/i) ||
      statement.match(/^ALTER TABLE\s+"(\w+)"/i) ||
      statement.match(/^CREATE(?:\s+UNIQUE)?\s+INDEX\s+"[^"]+"\s+ON\s+"(\w+)"/i) ||
      statement.match(/^CREATE POLICY\s+\S+\s+ON\s+"(\w+)"/i) ||
      // Trigger pertence à tabela em que está (central → removida, tenant → mantida).
      statement.match(/^CREATE(?:\s+OR\s+REPLACE)?(?:\s+CONSTRAINT)?\s+TRIGGER\s+\S+[\s\S]*?\sON\s+"(\w+)"/i) ||
      statement.match(/^DROP TRIGGER\s+(?:IF EXISTS\s+)?\S+\s+ON\s+"(\w+)"/i) ||
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
    if (NOOP_WHEN_REPLAYED_FROM_EMPTY.includes(name)) continue; // remediação de incidente — ver comentário acima
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
