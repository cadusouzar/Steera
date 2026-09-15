# Isolamento Físico por Schema PostgreSQL (Schema-per-Tenant) — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toda empresa criada a partir de agora nasce com seu próprio schema PostgreSQL físico, isolando fisicamente seus dados operacionais das demais — reaproveitando a infraestrutura de propagação de tenant (`AsyncLocalStorage` + interceptor + extensão Prisma) já existente, sem tocar nas empresas/dados que já existem.

**Architecture:** A extensão Prisma existente (`tenant-rls.extension.ts`), que já embrulha toda query numa mini-transação com `set_config('app.current_company_id', ...)` pra alimentar o RLS, ganha um segundo comando na mesma mini-transação: `SET LOCAL search_path TO "tenant_<companyId>", public`. `Company`/`User`/`RefreshToken`/`TenantMigration` continuam num schema central (`public`); todo o resto passa a viver em `tenant_<companyId>`. O `schema.prisma` e o histórico de migrations principal do projeto **não mudam de fluxo** — continuam sendo escritos exatamente como hoje (`npx prisma migrate dev`, um arquivo só). Um script de geração (rodado a cada migration nova, com o resultado revisado e commitado como qualquer outro arquivo) extrai, migration por migration, só os comandos SQL que pertencem a tabelas de tenant, produzindo um segundo histórico paralelo (`prisma/tenant-migrations/`) — é esse segundo histórico que é replicado dentro de cada schema `tenant_x`. RLS é mantida intacta como segunda camada de defesa.

**Tech Stack:** NestJS + Prisma + PostgreSQL (`backend/`), mesmo stack já usado no projeto — nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-15-schema-per-tenant-design.md`

## Global Constraints

- Nenhum dado ou empresa existente é migrado ou alterado nesta fase — só empresas **novas**, criadas a partir de agora, usam o modelo de schema-por-tenant. (Fase 2, fora de escopo, cobre a migração de dados existentes.)
- Nenhuma coluna `companyId` é removida de nenhum model. Nenhuma policy de RLS existente é alterada ou removida.
- O nome de um schema nunca é aceito de nenhuma requisição — é sempre calculado a partir do `companyId` já presente no claim assinado do JWT (`req.user.companyId`).
- `runAsSystem` (de `backend/src/prisma/tenant-context.ts`) só pode ser importado de `backend/src/auth/**` e `backend/test/**` (regra estrutural do ESLint, `.eslintrc.cjs`) — nenhum código deste plano fora dessas duas pastas deve importá-lo.
- Toda configuração de sessão do PostgreSQL usada para resolver o tenant (`search_path`, `app.current_company_id`) deve usar a forma **transaction-scoped** (`SET LOCAL ...` / `set_config(key, value, true)`), nunca a forma de sessão (`SET ...` puro / `set_config(key, value, false)`) — o pool de conexões do Prisma reaproveita conexões físicas entre requisições lógicas diferentes, e uma configuração de sessão vazaria o tenant de uma requisição pra outra que reutilize a mesma conexão.
- O fluxo de autoria de migrations principal (`npx prisma migrate dev` contra `backend/prisma/schema.prisma`) **não muda** — nenhum developer precisa aprender um comando novo pra mudanças do dia a dia. O único passo novo é rodar o gerador (`npm run generate:tenant-migrations`) depois de criar uma migration, e revisar o arquivo gerado antes de commitar — documentado explicitamente na Task 3.
- `Holiday` permanece inteiramente central nesta fase (não é uma tabela de tenant) — decisão explícita, ver Task 3: seu volume é baixo e o isolamento por `companyId`+RLS que já existe hoje já é suficiente pra ela; não há ganho real em replicá-la fisicamente por tenant.
- Nenhuma infraestrutura nova (Docker, Redis, fila) é introduzida — o ambiente de desenvolvimento local continua `npm install` → Postgres local → `npm run start:dev`.

---

### Task 1: Utilitário de nome de schema

**Files:**
- Create: `backend/src/prisma/tenant-schema.util.ts`
- Test: `backend/src/prisma/tenant-schema.util.spec.ts`

**Interfaces:**
- Produces: `tenantSchemaName(companyId: string): string`, `assertValidSchemaName(schemaName: string): void` (throws `Error` se inválido) — consumidos pelas Tasks 5, 6, 7, 8.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// backend/src/prisma/tenant-schema.util.spec.ts
import { assertValidSchemaName, tenantSchemaName } from './tenant-schema.util';

describe('tenantSchemaName', () => {
  it('deriva o nome do schema como tenant_<companyId>', () => {
    expect(tenantSchemaName('cm2x9f8j40000abc123defg')).toBe('tenant_cm2x9f8j40000abc123defg');
  });
});

describe('assertValidSchemaName', () => {
  it('não lança para um nome de schema válido', () => {
    expect(() => assertValidSchemaName('tenant_cm2x9f8j40000abc123defg')).not.toThrow();
  });

  it.each([
    'tenant_',
    'tenant_ABC123',
    'tenant_abc-123',
    'tenant_abc 123',
    'tenant_abc"; DROP SCHEMA public CASCADE; --',
    'outraCoisa_abc123',
    '',
  ])('lança para um nome de schema inválido: %s', (invalid) => {
    expect(() => assertValidSchemaName(invalid)).toThrow();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && npx jest tenant-schema.util --testPathPattern=src`
Expected: FAIL — `Cannot find module './tenant-schema.util'`.

- [ ] **Step 3: Implementar**

```ts
// backend/src/prisma/tenant-schema.util.ts
// Nome do schema de uma empresa é uma função pura e determinística do seu id — nunca armazenado
// em coluna nenhuma (evitaria uma segunda fonte de verdade que poderia dessincronizar) e nunca
// aceito de requisição nenhuma (só calculado a partir do companyId já validado pelo JWT). O
// alfabeto do cuid() do Prisma é minúsculo alfanumérico (ex.: "cm2x9f8j40000abc123defg") — o regex
// abaixo é deliberadamente mais permissivo em tamanho (20-30) do que restrito ao formato exato do
// cuid(), pra não quebrar se o formato de id mudar de leve no futuro, mas continua rejeitando
// qualquer caractere fora de [a-z0-9] — o suficiente pra nunca permitir um nome de schema que
// escape das aspas duplas quando interpolado em SQL bruto.
const SCHEMA_NAME_REGEX = /^tenant_[a-z0-9]{20,30}$/;

export function tenantSchemaName(companyId: string): string {
  return `tenant_${companyId}`;
}

export function assertValidSchemaName(schemaName: string): void {
  if (!SCHEMA_NAME_REGEX.test(schemaName)) {
    throw new Error(`Nome de schema de tenant inválido: ${JSON.stringify(schemaName)}`);
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx jest tenant-schema.util --testPathPattern=src`
Expected: PASS, 8/8.

- [ ] **Step 5: Lint e commit**

Run: `npm run lint`
Expected: limpo.

```bash
git add backend/src/prisma/tenant-schema.util.ts backend/src/prisma/tenant-schema.util.spec.ts
git commit -m "feat(backend): add tenant schema naming utility"
```

---

### Task 2: Utilitário de listagem e leitura de arquivos de migration

**Files:**
- Create: `backend/src/prisma/migration-files.util.ts`
- Test: `backend/src/prisma/migration-files.util.spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `listMigrationNames(migrationsDir: string): string[]` (ordenado cronologicamente), `readMigrationSql(migrationsDir: string, migrationName: string): string` — consumidos pelas Tasks 3, 4, 7, 8. Diferente de um design anterior descartado, **ambas funções exigem `migrationsDir` explicitamente** (sem default) — este utilitário é compartilhado por DOIS diretórios de migration distintos neste plano (`prisma/migrations/`, o principal, e `prisma/tenant-migrations/`, o novo — ver Task 3), e um default implícito arriscaria um chamador esquecer de especificar qual dos dois quer.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// backend/src/prisma/migration-files.util.spec.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listMigrationNames, readMigrationSql } from './migration-files.util';

describe('listMigrationNames', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrations-test-'));
    mkdirSync(join(dir, '20260910000000_second'));
    writeFileSync(join(dir, '20260910000000_second', 'migration.sql'), '-- second');
    mkdirSync(join(dir, '20260909000000_first'));
    writeFileSync(join(dir, '20260909000000_first', 'migration.sql'), '-- first');
    writeFileSync(join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lista os diretórios de migration em ordem cronológica, ignorando migration_lock.toml', () => {
    expect(listMigrationNames(dir)).toEqual(['20260909000000_first', '20260910000000_second']);
  });

  it('devolve lista vazia para um diretório vazio (não lança)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'migrations-empty-'));
    expect(listMigrationNames(empty)).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe('readMigrationSql', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrations-test-'));
    mkdirSync(join(dir, '20260909000000_first'));
    writeFileSync(join(dir, '20260909000000_first', 'migration.sql'), 'CREATE TABLE "X" (id TEXT);');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lê o conteúdo do migration.sql de um diretório de migration', () => {
    expect(readMigrationSql(dir, '20260909000000_first')).toBe('CREATE TABLE "X" (id TEXT);');
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx jest migration-files.util --testPathPattern=src`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// backend/src/prisma/migration-files.util.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// Nomes de pasta de migration do Prisma começam com um timestamp (ex.: "20260909225101_init"),
// então a ordenação lexicográfica de string já é a ordem cronológica correta — sem precisar
// parsear nada. migration_lock.toml (arquivo, não pasta) fica na raiz de prisma/migrations/ e
// nunca é uma migration — excluído explicitamente, nunca por acidente de nomenclatura.
export function listMigrationNames(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => statSync(join(migrationsDir, name)).isDirectory())
    .sort();
}

export function readMigrationSql(migrationsDir: string, migrationName: string): string {
  return readFileSync(join(migrationsDir, migrationName, 'migration.sql'), 'utf-8');
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx jest migration-files.util --testPathPattern=src`
Expected: PASS, 3/3.

- [ ] **Step 5: Lint e commit**

```bash
git add backend/src/prisma/migration-files.util.ts backend/src/prisma/migration-files.util.spec.ts
git commit -m "feat(backend): add generic migration file listing utility"
```

---

### Task 3: Gerador do histórico de migrations de tenant

**Files:**
- Create: `backend/src/prisma/tenant-table-names.ts`
- Create: `backend/scripts/generate-tenant-migrations.ts`
- Create: `backend/prisma/tenant-migrations/` (diretório gerado — conteúdo produzido pelo script, não escrito à mão)
- Test: `backend/src/prisma/generate-tenant-migrations.util.spec.ts`
- Modify: `backend/package.json` (novo script npm)

**Interfaces:**
- Consumes: `listMigrationNames`, `readMigrationSql` (Task 2).
- Produces: `splitMigrationSqlByTenant(sql: string, tenantTableNames: readonly string[]): string` (o texto SQL filtrado, só com os comandos relevantes a tabelas de tenant) — consumido só por este script; o **resultado gerado** (`backend/prisma/tenant-migrations/<mesmo-nome>/migration.sql`, um arquivo por migration existente) é o que as Tasks 7 e 8 efetivamente leem.

**Contexto — por que este passo existe:** o histórico principal de migrations (`backend/prisma/migrations/`) tem, hoje, vários arquivos que misturam comandos de tabelas centrais (`Company`, `User`, `RefreshToken`) com comandos de tabelas de tenant no MESMO arquivo (ex.: a migration que ativou RLS mexe em `User` e em `Client`/`Employee`/etc. juntos). Reexecutar esse histórico inteiro, sem filtrar, dentro do schema de um tenant novo recriaria `Company`/`User`/`RefreshToken` duplicados lá dentro — e como `search_path` procura primeiro no schema do tenant, isso quebraria login/perfil de qualquer usuário daquela empresa (a consulta a `User` resolveria pra cópia vazia dentro do tenant, não pra tabela central de verdade). Este gerador produz um SEGUNDO histórico, `backend/prisma/tenant-migrations/`, com o mesmo nome de pasta de cada migration original, mas contendo só os comandos SQL que tocam uma tabela da lista de tenant — é ESSE segundo histórico que as Tasks 7/8 replicam dentro de cada `tenant_x`. **O fluxo de autoria de migrations não muda** (`npx prisma migrate dev` continua igual); só é preciso rodar `npm run generate:tenant-migrations` depois, e revisar o `git diff` do arquivo gerado antes de commitar — documentado no `package.json` e no `README`/`CLAUDE.md` (Task 11).

- [ ] **Step 1: Definir a lista de tabelas de tenant**

```ts
// backend/src/prisma/tenant-table-names.ts
// Toda tabela que representa dado operacional de UMA empresa só — fonte única de verdade pra
// classificar cada comando SQL de uma migration como "central" (ignorado ao gerar o histórico de
// tenant) ou "de tenant" (replicado). `Holiday` fica de fora de propósito: seus escopos
// NATIONAL/STATE são um catálogo compartilhado por todo o sistema, e o volume/risco de escopos
// COMPANY é baixo o suficiente pra não justificar, nesta fase, o isolamento físico — o
// companyId+RLS que já existe hoje já cobre esse caso corretamente. `Company`/`User`/
// `RefreshToken`/`TenantMigration` nunca entram aqui — são as tabelas centrais.
export const TENANT_TABLE_NAMES = [
  'Client',
  'Receivable',
  'Subscription',
  'Role',
  'Employee',
  'EmployeeWarning',
  'EmployeeRecurringPayment',
  'EmployeePayment',
  'VacationSchedule',
  'LeaveSchedule',
  'TimeTrackingSettings',
  'TimeEvent',
  'WorkSchedule',
  'WorkLocation',
  'TimeAdjustmentRequest',
  'TimeCorrection',
  'TimeJustification',
  'FileAsset',
  'AuditLog',
] as const;
```

- [ ] **Step 2: Escrever os testes que falham para o classificador de SQL**

```ts
// backend/src/prisma/generate-tenant-migrations.util.spec.ts
import { splitMigrationSqlByTenant } from '../../scripts/generate-tenant-migrations';

const TENANT_TABLES = ['Client', 'Employee'] as const;

describe('splitMigrationSqlByTenant', () => {
  it('mantém CREATE TABLE de uma tabela de tenant', () => {
    const sql = 'CREATE TABLE "Client" (\n    "id" TEXT NOT NULL\n);';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).toContain('CREATE TABLE "Client"');
  });

  it('remove CREATE TABLE de uma tabela central', () => {
    const sql = 'CREATE TABLE "Company" (\n    "id" TEXT NOT NULL\n);';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).not.toContain('CREATE TABLE "Company"');
  });

  it('mantém ALTER TABLE de uma tabela de tenant, mesmo referenciando uma tabela central via FK', () => {
    const sql = 'ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).toContain('ALTER TABLE "Client" ADD CONSTRAINT');
  });

  it('remove ALTER TABLE de uma tabela central', () => {
    const sql = 'ALTER TABLE "User" ADD COLUMN     "hasFullPontoAccess" BOOLEAN NOT NULL DEFAULT true;';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).not.toContain('ALTER TABLE "User"');
  });

  it('mantém CREATE INDEX numa tabela de tenant e remove numa tabela central', () => {
    const sql = [
      'CREATE INDEX "Client_companyId_idx" ON "Client"("companyId");',
      'CREATE UNIQUE INDEX "User_email_key" ON "User"("email");',
    ].join('\n\n');
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).toContain('Client_companyId_idx');
    expect(result).not.toContain('User_email_key');
  });

  it('mantém CREATE POLICY numa tabela de tenant e remove numa tabela central', () => {
    const sql = [
      'CREATE POLICY tenant_isolation ON "Client"\n  USING (true);',
      'CREATE POLICY tenant_isolation ON "User"\n  USING (true);',
    ].join('\n\n');
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).toContain('ON "Client"');
    expect(result).not.toContain('ON "User"');
  });

  it('mantém DROP INDEX cujo nome começa com uma tabela de tenant', () => {
    const sql = 'DROP INDEX "Client_oldIndex_key";';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).toContain('DROP INDEX "Client_oldIndex_key"');
  });

  it('remove DROP INDEX cujo nome começa com uma tabela central', () => {
    const sql = 'DROP INDEX "User_oldIndex_key";';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).not.toContain('User_oldIndex_key');
  });

  it('mantém UPDATE numa tabela de tenant e remove numa tabela central', () => {
    const sql = [
      'UPDATE "Client" SET "companyId" = (SELECT "id" FROM "Company" LIMIT 1);',
      'UPDATE "User" SET "mustChangePassword" = false;',
    ].join('\n\n');
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).toContain('UPDATE "Client"');
    expect(result).not.toContain('UPDATE "User"');
  });

  it('sempre mantém CREATE TYPE, mesmo de um enum usado só por tabela central — inofensivo, nunca lido via search_path de forma ambígua como uma tabela seria', () => {
    const sql = 'CREATE TYPE "UserRole" AS ENUM (\'ADMIN\', \'EMPLOYEE\');';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).toContain('CREATE TYPE "UserRole"');
  });

  it('remove linhas de comentário puro (--) do resultado', () => {
    const sql = '-- Só um comentário\nCREATE TABLE "Client" ("id" TEXT NOT NULL);';
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).not.toContain('Só um comentário');
    expect(result).toContain('CREATE TABLE "Client"');
  });

  it('mantém (por segurança, com aviso) um comando que não bate com nenhum padrão conhecido', () => {
    const sql = 'SELECT pg_advisory_lock(1);';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).toContain('pg_advisory_lock');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx jest generate-tenant-migrations.util --testPathPattern=src`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar o classificador e o script gerador**

```ts
// backend/scripts/generate-tenant-migrations.ts
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
      statement.match(/^DROP INDEX\s+"(\w+)_/i) ||
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
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx jest generate-tenant-migrations.util --testPathPattern=src`
Expected: PASS, 11/11.

- [ ] **Step 6: Adicionar o script npm**

Em `backend/package.json`, adicionar ao objeto `scripts`:

```json
"generate:tenant-migrations": "ts-node scripts/generate-tenant-migrations.ts"
```

- [ ] **Step 7: Gerar o histórico de tenant pela primeira vez e revisar o resultado**

```bash
cd backend
npm run generate:tenant-migrations
```

Ler o `migration.sql` gerado dentro de `prisma/tenant-migrations/` pra cada uma das migrations que originalmente misturavam central+tenant (`20260912211332_add_auth_multitenant`, `20260913140100_enable_row_level_security`, `20260913011521_add_must_change_password`, `20260914034100_add_time_tracking`, `20260915010503_scoped_ponto_config`) e confirmar manualmente: nenhuma menção a `CREATE TABLE "Company"`/`CREATE TABLE "User"`/`CREATE TABLE "RefreshToken"`, nenhum `ALTER TABLE "User" ...`/`ALTER TABLE "Company" ...`, nenhum `CREATE POLICY ... ON "User"`; e, ao mesmo tempo, que os comandos de `Client`/`Employee`/`TimeEvent`/etc. estão todos presentes. Confirmar também que `20260909225101_init` (a primeira migration, só Client/Receivable/Subscription) foi copiada quase por inteiro (sem nada central pra remover), e que `20260910162339_add_company` (só cria `Company`) resultou numa pasta **sem** arquivo `migration.sql` gerado (a migration inteira era central).

- [ ] **Step 8: Build, lint e commit**

```bash
npm run build && npm run lint
git add backend/src/prisma/tenant-table-names.ts backend/scripts/generate-tenant-migrations.ts backend/src/prisma/generate-tenant-migrations.util.spec.ts backend/package.json backend/prisma/tenant-migrations/
git commit -m "feat(backend): add tenant-only migration history generator"
```

---

### Task 4: Modelo `TenantMigration` + `applyMigrations()`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_tenant_migration/migration.sql`
- Create: `backend/src/prisma/tenant-migration.util.ts`
- Test: `backend/src/prisma/tenant-migration.util.spec.ts`

**Interfaces:**
- Consumes: `readMigrationSql` (Task 2), `assertValidSchemaName` (Task 1).
- Produces: `applyMigrations(tx: Prisma.TransactionClient | PrismaClient, companyId: string, schemaName: string, tenantMigrationsDir: string, migrationNames: string[]): Promise<void>` — consumido pelas Tasks 7 e 8.

- [ ] **Step 1: Adicionar o model ao schema**

Adicionar ao final de `backend/prisma/schema.prisma`:

```prisma
// Metadado central sobre tenants (não é dado operacional de empresa nenhuma) — registra quais
// migrations do histórico de TENANT (prisma/tenant-migrations/, ver Task 3 — não o histórico
// principal) já foram aplicadas em qual schema físico. Vive no schema central (`public`), sem RLS
// — mesma categoria de `Company`, consultada sempre via `runWithTenant`/sem contexto de tenant
// específico, nunca precisa de bypass.
model TenantMigration {
  id            String   @id @default(cuid())
  companyId     String
  company       Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  migrationName String
  appliedAt     DateTime @default(now())

  @@unique([companyId, migrationName])
  @@index([companyId])
}
```

Adicionar a back-relation em `model Company` (junto das outras back-relations já existentes):

```prisma
  tenantMigrations       TenantMigration[]
```

**Nota:** este model, por não estar em `TENANT_TABLE_NAMES` (Task 3), nunca é incluído no histórico de tenant gerado — é corretamente tratado como central, exatamente como `Company`/`User`/`RefreshToken`.

- [ ] **Step 2: Formatar, validar e gerar a migration**

```bash
cd backend
npx prisma format && npx prisma validate
mkdir -p "prisma/migrations/$(date +%Y%m%d%H%M%S)_add_tenant_migration"
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > "prisma/migrations/<pasta-gerada-acima>/migration.sql"
```

(Este projeto usa o workaround de `migrate diff` em vez de `migrate dev` por um erro pré-existente de shadow database neste ambiente local — mesmo padrão já usado em migrations anteriores deste projeto.)

- [ ] **Step 3: Aplicar, gerar o client, e regenerar o histórico de tenant**

```bash
npx prisma migrate deploy
npx prisma generate
npm run generate:tenant-migrations
```

Expected: `All migrations have been successfully applied.` / `✔ Generated Prisma Client`. Confirmar que a pasta `prisma/tenant-migrations/<esta-migration>` **não** foi criada (o model é central — nada a gerar).

- [ ] **Step 4: Escrever os testes que falham para `applyMigrations`**

```ts
// backend/src/prisma/tenant-migration.util.spec.ts
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
});
```

- [ ] **Step 5: Rodar os testes e confirmar que falham**

Run: `npx jest tenant-migration.util --testPathPattern=src`
Expected: FAIL — módulo não existe.

- [ ] **Step 6: Implementar**

```ts
// backend/src/prisma/tenant-migration.util.ts
import { PrismaClient, Prisma } from '@prisma/client';
import { assertValidSchemaName } from './tenant-schema.util';
import { readMigrationSql } from './migration-files.util';

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
    await tx.$executeRawUnsafe(sql);
    await (tx as PrismaClient).tenantMigration.create({ data: { companyId, migrationName } });
  }
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npx jest tenant-migration.util --testPathPattern=src`
Expected: PASS, 2/2.

- [ ] **Step 8: Teste de integração real — replay de migration contra um schema descartável**

```ts
// backend/test/tenant-migration-replay.e2e-spec.ts
import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import { listMigrationNames } from '../src/prisma/migration-files.util';
import { applyMigrations } from '../src/prisma/tenant-migration.util';

const TENANT_MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'tenant-migrations');

describe('applyMigrations (integration — Postgres real)', () => {
  const prisma = new PrismaClient();
  const schemaName = `tenant_test${Date.now()}`.slice(0, 30);
  let companyId: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!/\/quickflow_test(\?|$)/.test(url)) {
      throw new Error('DATABASE_URL must point to a *_test database for e2e tests');
    }
    const company = await prisma.company.create({ data: { name: 'Migration Replay Test Co' } });
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
```

Run: `npm run test:e2e -- tenant-migration-replay`
Expected: PASS — confirma, contra um Postgres de verdade, que o replay de migration funciona de ponta a ponta E não duplica nenhuma tabela central dentro do schema do tenant (é exatamente o teste que fecha o bug encontrado durante o planejamento).

- [ ] **Step 9: Lint, build e commit**

```bash
npm run lint && npm run build
git add backend/prisma/schema.prisma backend/prisma/migrations/ backend/prisma/tenant-migrations/ backend/src/prisma/tenant-migration.util.ts backend/src/prisma/tenant-migration.util.spec.ts backend/test/tenant-migration-replay.e2e-spec.ts
git commit -m "feat(backend): add TenantMigration model and applyMigrations replay utility"
```

---

### Task 5: Extensão Prisma — `search_path` dinâmico por tenant

**Files:**
- Modify: `backend/src/prisma/tenant-rls.extension.ts`
- Test: `backend/src/prisma/tenant-rls.extension.spec.ts` (criar se não existir — verificar antes)

**Interfaces:**
- Consumes: `tenantSchemaName`, `assertValidSchemaName` (Task 1).
- Produces: comportamento estendido de `tenantRlsExtension`, `runTenantTransaction`, `runTenantInteractiveTransaction` — nenhuma assinatura de função muda, só o SQL que executam por baixo. Consumido implicitamente por todo o resto do backend (toda chamada Prisma já passa por aqui).

- [ ] **Step 1: Verificar se já existe um spec para este arquivo**

Run: `find backend/src/prisma -name "tenant-rls.extension.spec.ts"`. Se existir, leia-o primeiro e siga exatamente a convenção de mock já estabelecida (como `base.$transaction`/`base.$executeRaw` são mockados) em vez de criar um padrão novo.

- [ ] **Step 2: Escrever/estender os testes que falham**

```ts
// (adicionar ao spec existente, ou criar backend/src/prisma/tenant-rls.extension.spec.ts seguindo
// o padrão abaixo se não houver um já)
import { runAsSystem, runWithTenant } from './tenant-context';
import { tenantRlsExtension } from './tenant-rls.extension';

describe('tenantRlsExtension — search_path', () => {
  it('define SET LOCAL search_path pro schema do tenant, além do set_config já existente', async () => {
    const executedRawUnsafe: string[] = [];
    const base = {
      $executeRaw: jest.fn((..._args: unknown[]) => 'set-config-stmt'),
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
```

Ajuste o teste acima às asserções exatas que o spec já existente (se houver) usa pra mockar `$transaction`/`$executeRaw` — o ponto essencial a preservar é: (a) modo tenant normal chama `$executeRawUnsafe` com `SET LOCAL search_path TO "tenant_<id>", public` como primeiro item do array passado a `$transaction`, seguido do `set_config` e por último a query; (b) modo bypass nunca chama `$executeRawUnsafe`.

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx jest tenant-rls.extension --testPathPattern=src`
Expected: FAIL — comportamento atual não define `search_path`.

- [ ] **Step 4: Implementar**

Substituir o corpo de `$allOperations` em `tenant-rls.extension.ts`:

```ts
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantStore, runInsideExplicitTenantTransaction } from './tenant-context';
import { assertValidSchemaName, tenantSchemaName } from './tenant-schema.util';

// ... (comentário de topo do arquivo permanece o mesmo, sem alteração)

export function tenantRlsExtension(base: PrismaClient) {
  return Prisma.defineExtension({
    name: 'tenant-rls',
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const store = getTenantStore();

          if (!store || store.insideExplicitTx) return query(args);
          if (!store.companyId && !store.bypass) return query(args);

          const statements: Prisma.PrismaPromise<unknown>[] = [];

          if (store.bypass) {
            // Modo bypass (login/register/refresh pré-autenticação, setup/teardown de e2e): nunca
            // define search_path — essas operações só tocam tabelas centrais (User/Company), que
            // já resolvem corretamente contra `public` (o search_path padrão de uma conexão nova
            // do Postgres), sem precisar de nenhum comando extra.
            statements.push(base.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`);
          } else {
            // SET LOCAL (nunca SET puro) — mesma razão exata do set_config(..., true) logo abaixo:
            // sem o LOCAL, o search_path persistiria na conexão física pooled além desta
            // mini-transação, vazando o schema de uma empresa pra uma requisição de outra empresa
            // que reaproveite a mesma conexão depois.
            const schemaName = tenantSchemaName(store.companyId!);
            assertValidSchemaName(schemaName);
            statements.push(base.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`));
            statements.push(base.$executeRaw`SELECT set_config('app.current_company_id', ${store.companyId}, true)`);
          }

          statements.push(query(args));

          const results = await base.$transaction(statements);
          return results[results.length - 1];
        },
      },
    },
  });
}
```

Atualizar também `runTenantTransaction` e `runTenantInteractiveTransaction` no mesmo arquivo — ambos precisam definir o mesmo `SET LOCAL search_path` como parte do MESMO array/callback que já define o `set_config`, pelo mesmo motivo (operações dentro de uma transação explícita passam direto pelo hook acima, então o search_path precisa ser definido manualmente ali, não pela extensão):

```ts
export function runTenantTransaction<T extends readonly Prisma.PrismaPromise<unknown>[]>(
  prisma: { $transaction: PrismaClient['$transaction']; $executeRaw: PrismaClient['$executeRaw']; $executeRawUnsafe: PrismaClient['$executeRawUnsafe'] },
  ops: [...T],
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const store = getTenantStore();
  const transact = prisma.$transaction.bind(prisma) as (
    ops: Prisma.PrismaPromise<unknown>[],
  ) => Promise<unknown[]>;

  if (!store || (!store.companyId && !store.bypass)) {
    return transact(ops as unknown as Prisma.PrismaPromise<unknown>[]) as unknown as Promise<{
      [K in keyof T]: Awaited<T[K]>;
    }>;
  }

  const setupStatements: Prisma.PrismaPromise<unknown>[] = [];
  if (store.bypass) {
    setupStatements.push(prisma.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`);
  } else {
    const schemaName = tenantSchemaName(store.companyId!);
    assertValidSchemaName(schemaName);
    setupStatements.push(prisma.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`));
    setupStatements.push(prisma.$executeRaw`SELECT set_config('app.current_company_id', ${store.companyId}, true)`);
  }

  return runInsideExplicitTenantTransaction(async () => {
    const results = await transact([...setupStatements, ...(ops as unknown as Prisma.PrismaPromise<unknown>[])]);
    return results.slice(setupStatements.length) as unknown as { [K in keyof T]: Awaited<T[K]> };
  });
}

export function runTenantInteractiveTransaction<T>(
  prisma: { $transaction: PrismaClient['$transaction'] },
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const store = getTenantStore();
  if (!store || (!store.companyId && !store.bypass)) {
    return prisma.$transaction(fn);
  }
  return prisma.$transaction(async (tx) => {
    if (store.bypass) {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    } else {
      const schemaName = tenantSchemaName(store.companyId!);
      assertValidSchemaName(schemaName);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
      await tx.$executeRaw`SELECT set_config('app.current_company_id', ${store.companyId}, true)`;
    }
    return runInsideExplicitTenantTransaction(() => fn(tx));
  });
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx jest tenant-rls.extension --testPathPattern=src`
Expected: PASS.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: nenhuma suíte quebrada — nenhum service muda de comportamento pra empresas que já existem hoje (elas continuam sem schema físico próprio nesta fase; a extensão só passa a tentar `SET LOCAL search_path` pra um schema que ainda não existe pra elas — ver a nota de risco abaixo).

**Nota de risco explícita, aceita:** depois desta task, qualquer requisição de uma empresa **já existente** (criada antes desta migração) vai falhar, porque `tenant_<companyId>` dela não existe fisicamente ainda — `SET LOCAL search_path TO "tenant_x", public` não lança erro (Postgres ignora silenciosamente um schema inexistente na lista de busca), mas a consulta seguinte a `"Client"` etc. vai falhar com `relation "Client" does not exist` (a tabela não existe em `public` nem em `tenant_x` pra essa empresa antiga, já que `Client` só é criado dentro de `public` pela primeira vez através do fluxo pré-existente, que continua rodando pra manter os testes atuais funcionando — mas nenhuma empresa REAL, só de teste, depende disso hoje). **Isso é aceitável e esperado nesta fase**, confirmado com o usuário: só há dados de teste hoje, nenhuma empresa real precisa continuar funcionando sob o modelo antigo depois desta task especificamente.

- [ ] **Step 7: Lint e commit**

```bash
npm run lint
git add backend/src/prisma/tenant-rls.extension.ts backend/src/prisma/tenant-rls.extension.spec.ts
git commit -m "feat(backend): extend the Prisma tenant extension to set search_path per tenant schema"
```

---

### Task 6: Verificar privilégio de `CREATE SCHEMA` do usuário de banco

**Files:**
- Modify: `backend/.env.example`
- Modify: `backend/.env.test.example`

**Interfaces:**
- Nenhuma nova — task de verificação/documentação de infraestrutura, pré-requisito da Task 7.

- [ ] **Step 1: Verificar o privilégio localmente**

```bash
psql "$DATABASE_URL" -c "SELECT has_database_privilege(current_user, current_database(), 'CREATE');"
```

Expected: `t` (true). Se vier `f`, o usuário do banco (ex.: `quickflow_app`) precisa do privilégio `CREATE` no banco de dados — rode, autenticado como um usuário com permissão (ex.: `postgres`):

```sql
GRANT CREATE ON DATABASE quickflow TO quickflow_app;
```

Repetir a mesma verificação/grant pro banco `quickflow_test` usado por `npm run test:e2e`.

- [ ] **Step 2: Documentar o pré-requisito**

Adicionar um comentário em `backend/.env.example` e `backend/.env.test.example`, logo acima da linha `DATABASE_URL=...`:

```
# O usuário do banco referenciado aqui precisa ter o privilégio CREATE no banco de dados —
# necessário desde a Fase 1 do isolamento por schema-por-tenant, que roda `CREATE SCHEMA` a cada
# nova empresa registrada. Verificar com:
#   psql "$DATABASE_URL" -c "SELECT has_database_privilege(current_user, current_database(), 'CREATE');"
# Se vier `f`, rodar (autenticado como um usuário com permissão): GRANT CREATE ON DATABASE <nome> TO <usuario>;
```

- [ ] **Step 3: Commit**

```bash
git add backend/.env.example backend/.env.test.example
git commit -m "docs(backend): document the CREATE SCHEMA privilege prerequisite for schema-per-tenant"
```

---

### Task 7: Provisionamento transacional de empresa nova

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Test: `backend/src/auth/auth.service.spec.ts` (localizar o arquivo real de teste de `AuthService` antes de editar — o nome exato pode variar)

**Interfaces:**
- Consumes: `tenantSchemaName`, `assertValidSchemaName` (Task 1), `listMigrationNames` (Task 2), `applyMigrations` (Task 4).
- Produces: `AuthService.register()`'s novo comportamento — nenhuma mudança na assinatura pública do método nem no formato da resposta HTTP.

- [ ] **Step 1: Ler o `register()` atual por completo**

Confirmar a estrutura exata atual (já lida durante a fase de design desta spec):

```ts
async register(dto: { companyName: string; email: string; password: string }, res: Response) {
  const passwordHash = await hashPassword(dto.password);
  let user;
  try {
    user = await runAsSystem(() =>
      runTenantInteractiveTransaction(this.prisma, async (tx) => {
        const company = await tx.company.create({ data: { name: dto.companyName } });
        return tx.user.create({
          data: { companyId: company.id, email: dto.email, passwordHash, role: 'ADMIN', modules: ALL_MODULES },
        });
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('Este e-mail já está cadastrado');
    }
    throw err;
  }
  // ...
}
```

- [ ] **Step 2: Escrever os testes que falham**

Localizar e ler o spec real de `AuthService` primeiro (`find backend/src/auth -iname "auth.service.spec.ts"`), confirmar como `PrismaService`/`runTenantInteractiveTransaction` já são mockados ali, e adicionar, seguindo a mesma convenção:

```ts
  describe('register — provisionamento de schema', () => {
    it('cria o schema físico e aplica todas as migrations de tenant dentro da mesma transação, antes de criar o usuário', async () => {
      // Id no formato cuid-like (minúsculo alfanumérico, sem hífen) — assertValidSchemaName
      // (Task 1) rejeitaria um valor com hífen antes de chegar no CREATE SCHEMA.
      const companyId = 'companyabc123456789012345';
      const tx = {
        company: { create: jest.fn().mockResolvedValue({ id: companyId }) },
        user: { create: jest.fn().mockResolvedValue({ id: 'user-1', companyId, email: 'a@b.com', role: 'ADMIN', modules: [], mustChangePassword: false, employeeId: null, hasFullPontoAccess: true }) },
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      };
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx));

      await service.register({ companyName: 'Acme', email: 'a@b.com', password: 'senha123456' }, mockRes);

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining(`CREATE SCHEMA "tenant_${companyId}"`),
      );
      const callOrder = tx.$executeRawUnsafe.mock.invocationCallOrder;
      const userCreateOrder = tx.user.create.mock.invocationCallOrder[0];
      expect(Math.max(...callOrder)).toBeLessThan(userCreateOrder);
    });
  });
```

Ajuste os detalhes de mock exatos ao padrão real já usado no arquivo (nome da variável do mock do Prisma, como `$transaction` já é mockado hoje pra `runTenantInteractiveTransaction` funcionar nos testes existentes de `register()`) — o essencial a provar é: o `CREATE SCHEMA` acontece, e acontece **antes** de `tx.user.create`.

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx jest auth.service --testPathPattern=src`
Expected: FAIL — comportamento atual não cria schema nenhum.

- [ ] **Step 4: Implementar**

```ts
import { tenantSchemaName, assertValidSchemaName } from '../prisma/tenant-schema.util';
import { listMigrationNames } from '../prisma/migration-files.util';
import { applyMigrations } from '../prisma/tenant-migration.util';
import { join } from 'path';

// process.cwd(), não __dirname: __dirname aponta pra dentro de `dist/src/auth` depois de
// compilado (`npm run build` + `node dist/main.js`), onde `prisma/` não existe — mesmo padrão já
// usado em FilesService.STORAGE_ROOT (`join(process.cwd(), 'storage', 'attachments')`), que
// assume `npm run start:dev`/`start:prod` sempre rodam com o diretório de trabalho em `backend/`
// (garantido pelo próprio npm, que sempre executa scripts com CWD = pasta do package.json).
const TENANT_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'tenant-migrations');

// ... dentro da classe AuthService, substituir o corpo do try em register():

  async register(dto: { companyName: string; email: string; password: string }, res: Response) {
    const passwordHash = await hashPassword(dto.password);
    let user;
    try {
      user = await runAsSystem(() =>
        runTenantInteractiveTransaction(this.prisma, async (tx) => {
          const company = await tx.company.create({ data: { name: dto.companyName } });
          const schemaName = tenantSchemaName(company.id);
          assertValidSchemaName(schemaName);
          // CREATE SCHEMA e a migration replay abaixo rodam DENTRO desta mesma transação
          // PostgreSQL — DDL é transacional no Postgres, então qualquer falha (schema, uma
          // migration específica) desfaz TUDO, incluindo o INSERT do Company acima: nunca existe
          // uma empresa com schema pela metade, e uma segunda tentativa após falha é sempre
          // segura (não há sujeira residual pra limpar).
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schemaName}", public`);
          await applyMigrations(tx, company.id, schemaName, TENANT_MIGRATIONS_DIR, listMigrationNames(TENANT_MIGRATIONS_DIR));
          // "User" só existe em `public` — resolve corretamente mesmo com o search_path acima
          // apontando primeiro pro schema do tenant (o PostgreSQL cai pro próximo item da lista).
          return tx.user.create({
            data: { companyId: company.id, email: dto.email, passwordHash, role: 'ADMIN', modules: ALL_MODULES },
          });
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Este e-mail já está cadastrado');
      }
      throw err;
    }
    const accessToken = this.signAccessToken(user);
    const refreshValue = await this.issueRefreshToken(user.id);
    this.setRefreshCookie(res, refreshValue);
    return { accessToken, user: this.toPublicUser(user) };
  }
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx jest auth.service --testPathPattern=src`
Expected: PASS.

- [ ] **Step 6: Teste de integração real — provisionamento de ponta a ponta**

```ts
// backend/test/tenant-provisioning.e2e-spec.ts
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

    const loginRes = await request(server)
      .post('/auth/login')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ email, password: 'senha-de-teste-12345' })
      .expect(200);
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
    await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
    await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId: dupUser.companyId } }));
    await sys(() => prisma.user.deleteMany({ where: { companyId: dupUser.companyId } }));
    await sys(() => prisma.company.delete({ where: { id: dupUser.companyId } }));
  });
});
```

Run: `npm run test:e2e -- tenant-provisioning`
Expected: PASS — prova, contra um Postgres de verdade, que o schema é criado sem duplicar tabelas centrais, e que o admin consegue logar e buscar o próprio perfil (`GET /auth/me`) de fato.

- [ ] **Step 7: Lint, build e commit**

```bash
npm run lint && npm run build
git add backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts backend/test/tenant-provisioning.e2e-spec.ts
git commit -m "feat(backend): provision a physical tenant schema transactionally on company registration"
```

---

### Task 8: `TenantMigrationManager` — catch-up para empresas existentes

**Files:**
- Create: `backend/src/tenant-migration/tenant-migration-manager.service.ts`
- Create: `backend/src/tenant-migration/tenant-migration.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/src/tenant-migration/tenant-migration-manager.service.spec.ts`

**Interfaces:**
- Consumes: `tenantSchemaName`, `assertValidSchemaName` (Task 1), `listMigrationNames` (Task 2), `applyMigrations` (Task 4), `runWithTenant` (já existente, sem mudança).
- Produces: `TenantMigrationManagerService.applyPendingMigrationsToAllTenants(): Promise<void>` — usado por este módulo internamente (`@Cron`/`OnApplicationBootstrap`), não consumido por nenhuma task futura deste plano.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// backend/src/tenant-migration/tenant-migration-manager.service.spec.ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { TenantMigrationManagerService } from './tenant-migration-manager.service';

jest.mock('../prisma/migration-files.util', () => ({
  listMigrationNames: () => ['20260101000000_a', '20260102000000_b'],
}));
jest.mock('../prisma/tenant-migration.util', () => ({
  applyMigrations: jest.fn().mockResolvedValue(undefined),
}));

describe('TenantMigrationManagerService', () => {
  let service: TenantMigrationManagerService;
  let prisma: {
    company: { findMany: jest.Mock };
    tenantMigration: { findMany: jest.Mock };
    $executeRawUnsafe: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      company: { findMany: jest.fn() },
      tenantMigration: { findMany: jest.fn() },
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      // Tagged-template call (usado por runTenantInteractiveTransaction's set_config) — um
      // jest.fn() comum já recebe (strings, ...values) normalmente quando chamado como template.
      $executeRaw: jest.fn().mockResolvedValue(0),
      // `runTenantInteractiveTransaction` (Task 5, exercitado de verdade aqui, não mockado) chama
      // `prisma.$transaction(async (tx) => {...})` — passar `prisma` como o próprio `tx` é o
      // mesmo padrão de mock já usado no resto deste projeto pra esse helper.
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [TenantMigrationManagerService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(TenantMigrationManagerService);
  });

  // IDs no formato cuid-like (20-30 chars minúsculos alfanuméricos) de propósito — o regex de
  // assertValidSchemaName (Task 1), agora genuinamente exercitado aqui via
  // runTenantInteractiveTransaction (não mockado), rejeitaria um id de teste do tipo "company-1".
  const companyId1 = 'company1cuidlikeid1234567';
  const companyId2 = 'company2cuidlikeid1234567';

  it('aplica só as migrations pendentes de cada empresa, pulando quem já está em dia', async () => {
    prisma.company.findMany.mockResolvedValue([{ id: companyId1 }, { id: companyId2 }]);
    prisma.tenantMigration.findMany.mockImplementation(({ where }: any) =>
      where.companyId === companyId1
        ? [{ migrationName: '20260101000000_a' }, { migrationName: '20260102000000_b' }]
        : [{ migrationName: '20260101000000_a' }],
    );

    const { applyMigrations } = require('../prisma/tenant-migration.util');
    await service.applyPendingMigrationsToAllTenants();

    expect(applyMigrations).toHaveBeenCalledTimes(1);
    expect(applyMigrations).toHaveBeenCalledWith(
      expect.anything(),
      companyId2,
      `tenant_${companyId2}`,
      expect.any(String),
      ['20260102000000_b'],
    );
  });

  it('não chama applyMigrations quando toda empresa já está em dia', async () => {
    prisma.company.findMany.mockResolvedValue([{ id: companyId1 }]);
    prisma.tenantMigration.findMany.mockResolvedValue([
      { migrationName: '20260101000000_a' },
      { migrationName: '20260102000000_b' },
    ]);

    const { applyMigrations } = require('../prisma/tenant-migration.util');
    await service.applyPendingMigrationsToAllTenants();

    expect(applyMigrations).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx jest tenant-migration-manager --testPathPattern=src`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o service**

```ts
// backend/src/tenant-migration/tenant-migration-manager.service.ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { runWithTenant } from '../prisma/tenant-context';
import { runTenantInteractiveTransaction } from '../prisma/tenant-rls.extension';
import { assertValidSchemaName, tenantSchemaName } from '../prisma/tenant-schema.util';
import { listMigrationNames } from '../prisma/migration-files.util';
import { applyMigrations } from '../prisma/tenant-migration.util';

// process.cwd(), não __dirname — mesmo motivo documentado em auth.service.ts (Task 7): __dirname
// aponta pra dentro de `dist/` depois de compilado, onde `prisma/` não existe.
const TENANT_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'tenant-migrations');

// Mesmo padrão já usado em BillingSchedulerService/ClientTrashService: itera toda Company (tabela
// central, sem RLS, não precisa de contexto de tenant pra ser lida) e processa uma por uma. Aqui,
// "processar" significa "aplicar as migrations de TENANT (prisma/tenant-migrations/, não o
// histórico principal — ver Task 3) que essa empresa ainda não tem" — nenhuma migration nova
// precisa ser rodada manualmente empresa por empresa depois de um deploy.
@Injectable()
export class TenantMigrationManagerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TenantMigrationManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.applyPendingMigrationsToAllTenants();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async runDailyCron() {
    await this.applyPendingMigrationsToAllTenants();
  }

  async applyPendingMigrationsToAllTenants(): Promise<void> {
    const allMigrations = listMigrationNames(TENANT_MIGRATIONS_DIR);
    const companies = await this.prisma.company.findMany({ select: { id: true } });

    for (const company of companies) {
      try {
        await runWithTenant(company.id, async () => {
          const applied = await this.prisma.tenantMigration.findMany({
            where: { companyId: company.id },
            select: { migrationName: true },
          });
          const appliedSet = new Set(applied.map((a) => a.migrationName));
          const pending = allMigrations.filter((name) => !appliedSet.has(name));
          if (pending.length === 0) return;

          const schemaName = tenantSchemaName(company.id);
          assertValidSchemaName(schemaName);
          // runTenantInteractiveTransaction (não um `this.prisma.$transaction` cru) é obrigatório
          // aqui: ele lê o companyId já ativo no AsyncLocalStorage (posto pelo `runWithTenant`
          // acima) e define `SET LOCAL search_path`/`set_config` automaticamente como parte da
          // MESMA transação, além de marcar o contexto como `insideExplicitTx` — sem isso, cada
          // chamada de model dentro de `applyMigrations` (ex.: `tx.tenantMigration.create(...)`)
          // passaria de novo pelo hook da extensão, que tentaria abrir uma SEGUNDA transação
          // aninhada usando o client base em vez de `tx`, quebrando a atomicidade (mesma
          // armadilha já documentada em tenant-rls.extension.ts).
          await runTenantInteractiveTransaction(this.prisma, async (tx) => {
            await applyMigrations(tx, company.id, schemaName, TENANT_MIGRATIONS_DIR, pending);
          });
        });
      } catch (err) {
        this.logger.error(
          `Falha ao aplicar migrations de tenant pendentes na empresa ${company.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
```

- [ ] **Step 4: Criar o módulo**

```ts
// backend/src/tenant-migration/tenant-migration.module.ts
import { Module } from '@nestjs/common';
import { TenantMigrationManagerService } from './tenant-migration-manager.service';

@Module({
  providers: [TenantMigrationManagerService],
})
export class TenantMigrationModule {}
```

- [ ] **Step 5: Registrar em `app.module.ts`**

Adicionar `import { TenantMigrationModule } from './tenant-migration/tenant-migration.module';` e `TenantMigrationModule` ao array `imports` (junto dos demais módulos de feature).

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx jest tenant-migration-manager --testPathPattern=src`
Expected: PASS, 2/2.

- [ ] **Step 7: Build, lint e commit**

```bash
npm run build && npm run lint
git add backend/src/tenant-migration/ backend/src/app.module.ts
git commit -m "feat(backend): add TenantMigrationManagerService to catch up existing tenants on new tenant migrations"
```

---

### Task 9: Isolamento de arquivos por empresa

**Files:**
- Modify: `backend/src/files/files.service.ts`
- Test: `backend/src/files/files.service.spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nenhuma mudança de assinatura pública — só onde o arquivo físico é gravado/lido em disco.

- [ ] **Step 1: Ler o `files.service.ts` atual por completo**

Confirmar a estrutura exata (já lida na fase de design):
```ts
const STORAGE_ROOT = join(process.cwd(), 'storage', 'attachments');
// ...
const storagePath = join('attachments', storedName);
await writeFile(join(STORAGE_ROOT, storedName), bufferToStore);
// ...
async streamPath(storagePath: string) {
  const fullPath = join(STORAGE_ROOT, storagePath.replace(/^attachments[\\/]/, ''));
```

- [ ] **Step 2: Escrever os testes que falham**

Localizar o spec real (`files.service.spec.ts`) e adicionar, seguindo a convenção de mock já existente pra `writeFile`/`readFile`:

```ts
  it('grava o arquivo numa subpasta isolada por companyId', async () => {
    const result = await service.upload({ companyId: 'company-xyz', /* ...demais campos do upload já existentes... */ });
    expect(result.storagePath).toMatch(/^attachments[\\/]company-xyz[\\/]/);
  });
```

Ajuste os demais argumentos do `upload(...)` acima aos campos reais exigidos pela assinatura atual do método (ler o arquivo primeiro).

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `npx jest files.service --testPathPattern=src`
Expected: FAIL — path atual não inclui `companyId`.

- [ ] **Step 4: Implementar**

```ts
const storagePath = join('attachments', companyId, storedName);
await mkdir(join(STORAGE_ROOT, companyId), { recursive: true });
await writeFile(join(STORAGE_ROOT, companyId, storedName), bufferToStore);
```

(Importar `mkdir` de `node:fs/promises` junto de `writeFile`, se ainda não importado. Confirmar no código real se `STORAGE_ROOT` em si já é criado com `{ recursive: true }` em algum ponto de bootstrap — se sim, aplicar o mesmo padrão pro subdiretório de `companyId`.)

```ts
async streamPath(storagePath: string) {
  const fullPath = join(STORAGE_ROOT, storagePath.replace(/^attachments[\\/]/, ''));
```
Este método já usa o `storagePath` completo (que agora inclui `companyId` no meio) — confirmar que nenhuma mudança é necessária aqui além de já receber o novo formato de `storagePath` (o `replace` já remove só o prefixo `attachments/`, deixando `companyId/storedName` intacto).

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx jest files.service --testPathPattern=src`
Expected: PASS.

- [ ] **Step 6: Build, lint e commit**

```bash
npm run build && npm run lint
git add backend/src/files/files.service.ts backend/src/files/files.service.spec.ts
git commit -m "feat(backend): isolate uploaded file storage by companyId"
```

---

### Task 10: Teste e2e de isolamento físico cross-tenant

**Files:**
- Create: `backend/test/schema-tenant-isolation.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores diretamente — exercita o sistema de ponta a ponta via HTTP real.

- [ ] **Step 1: Escrever o teste completo**

Seguindo o mesmo padrão de `test/rls-tenant-isolation.e2e-spec.ts` (já lido na fase de design), mas provando separação física de schema em vez de RLS:

```ts
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

describe('Isolamento físico por schema — cross-tenant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyAId: string;
  let companyBId: string;
  let tokenA: string;
  let tokenB: string;
  let clientBId: string;

  const runId = Date.now();
  const emailA = `schema-a-${runId}@test.com`;
  const emailB = `schema-b-${runId}@test.com`;

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

    const server = app.getHttpServer();

    const registerA = await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Schema Isolation Co A', email: emailA, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenA = `Bearer ${registerA.body.accessToken}`;

    const registerB = await request(server)
      .post('/auth/register')
      .set('x-requested-with', 'XMLHttpRequest')
      .send({ companyName: 'Schema Isolation Co B', email: emailB, password: 'senha-de-teste-12345' })
      .expect(201);
    tokenB = `Bearer ${registerB.body.accessToken}`;

    const userA = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: emailA } }));
    const userB = await sys(() => prisma.user.findUniqueOrThrow({ where: { email: emailB } }));
    companyAId = userA.companyId;
    companyBId = userB.companyId;

    await request(server)
      .post('/clients')
      .send({ name: 'Cliente João (A)', contact: '(11) 90000-0000' })
      .set('Authorization', tokenA)
      .expect(201);

    const createB = await request(server)
      .post('/clients')
      .send({ name: 'Cliente Maria (B)', contact: '(11) 90000-0001' })
      .set('Authorization', tokenB)
      .expect(201);
    clientBId = createB.body.id;
  });

  afterAll(async () => {
    for (const companyId of [companyAId, companyBId]) {
      const schemaName = `tenant_${companyId}`;
      await sys(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      await sys(() => prisma.tenantMigration.deleteMany({ where: { companyId } }));
      await sys(() => prisma.user.deleteMany({ where: { companyId } }));
      await sys(() => prisma.company.delete({ where: { id: companyId } }));
    }
    await app.close();
  });

  it('cada empresa tem um schema PostgreSQL físico distinto', async () => {
    const schemas = await sys(() =>
      prisma.$queryRawUnsafe<{ schema_name: string }[]>(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('tenant_${companyAId}', 'tenant_${companyBId}')`,
      ),
    );
    expect(schemas.length).toBe(2);
  });

  it('a listagem de clientes da Empresa A nunca inclui um cliente da Empresa B', async () => {
    const res = await request(app.getHttpServer())
      .get('/clients?pageSize=100')
      .set('Authorization', tokenA)
      .expect(200);
    const names = (res.body.items as Array<{ name: string }>).map((c) => c.name);
    expect(names).toContain('Cliente João (A)');
    expect(names).not.toContain('Cliente Maria (B)');
  });

  it('tentativa deliberada de acessar um cliente da Empresa B pelo id, autenticado como Empresa A, retorna 404', async () => {
    await request(app.getHttpServer())
      .get(`/clients/${clientBId}`)
      .set('Authorization', tokenA)
      .expect(404);
  });
});
```

**Nota sobre a mudança de comportamento documentada no design:** os dois casos de teste do arquivo `rls-tenant-isolation.e2e-spec.ts` que hoje esperam `toEqual([])` pra "sem contexto de tenant"/"tenant inexistente" **não se aplicam mais do mesmo jeito** com separação física de schema — sem `Client` existir em `public` pra uma empresa nova, uma consulta sem um schema de tenant válido agora lança (`relation "Client" does not exist`, virando `500` via `HttpExceptionFilter`) em vez de devolver uma lista vazia. Isso é uma consequência entendida e aceita do desenho (mais estrito, nunca retorna dado errado — só falha alto em vez de falso-vazio) — não precisa de um teste correspondente aqui: nenhum login de verdade tem um `companyId` sem schema válido (todo `companyId` num JWT emitido vem de uma empresa que passou pelo provisionamento da Task 7).

- [ ] **Step 2: Rodar o teste**

Run: `npm run test:e2e -- schema-tenant-isolation`
Expected: PASS, 3/3.

- [ ] **Step 3: Commit**

```bash
git add backend/test/schema-tenant-isolation.e2e-spec.ts
git commit -m "test(backend): add e2e cross-tenant physical schema isolation suite"
```

---

### Task 11: Validação final + documentação

**Files:**
- Modify: `CLAUDE.md`
- Modify (vault, fora deste repositório git): `B:\Quickflow\Quickflow\DECISOES-TECNICAS.md`, `ARQUITETURA.md`, `BANCO-DE-DADOS.md`, `AMBIENTE-LOCAL.md`

- [ ] **Step 1: Validação completa do backend**

```bash
cd backend
npx prisma migrate status
npm test
npm run test:e2e
npm run lint
npm run build
npm run start:dev   # boot limpo — confirmar "Nest application successfully started", sem erro, então parar
```

- [ ] **Step 2: Validação manual em navegador/HTTP real**

Registrar duas empresas novas via `/auth/register` (curl ou navegador), confirmar:
- Ambas conseguem logar e usar o ERP normalmente (clientes, funcionários, ponto).
- `psql` direto no banco confirma dois schemas físicos distintos (`\dn` lista `tenant_<idA>`, `tenant_<idB>`), e que **nenhum dos dois** tem uma tabela `Company`/`User`/`RefreshToken` própria (`\dt tenant_<idA>.*` não deve listar essas três).
- Nenhum dado se mistura entre as duas ao navegar pela UI.

- [ ] **Step 3: Atualizar `CLAUDE.md`**

Adicionar uma nova subseção em "Backend" (mesmo padrão de densidade das seções já existentes), documentando:
- A mudança de RLS-só pra schema-físico-por-tenant + RLS-como-backstop.
- A Fase 1 vs. Fase 2 (dados existentes fora de escopo).
- O `TenantMigrationManager` e o novo diretório `prisma/tenant-migrations/`.
- **O novo passo no fluxo de migration:** depois de `npx prisma migrate dev` criar uma migration tocando qualquer tabela de tenant, rodar `npm run generate:tenant-migrations` e revisar o `git diff` do arquivo gerado antes de commitar — se a migration toca só tabelas centrais (`Company`/`User`/`RefreshToken`/`TenantMigration`), o gerador simplesmente não produz nada pra ela (comportamento esperado, não um erro).
- A lista de tabelas de tenant (`TENANT_TABLE_NAMES`) e a decisão de manter `Holiday` inteiramente central nesta fase.
- O pré-requisito de privilégio `CREATE SCHEMA` do usuário de banco.
- O bug encontrado e corrigido durante o planejamento (histórico único de migration duplicaria `Company`/`User`/`RefreshToken` dentro de cada schema de tenant) e a solução (segundo histórico filtrado).

- [ ] **Step 4: Atualizar o vault**

Ler `DECISOES-TECNICAS.md`, `ARQUITETURA.md`, `BANCO-DE-DADOS.md` e `AMBIENTE-LOCAL.md` (existem, de fases anteriores deste projeto) antes de editar — adicionar a decisão completa (motivação, opções A/B/C descartadas/escolhidas, o trade-off de segurança da identidade central vs. subdomínio, o bug do histórico único de migration e sua correção) em `DECISOES-TECNICAS.md`; atualizar o mapa de módulos em `ARQUITETURA.md`; documentar o novo model `TenantMigration`, a divisão central/tenant, e o novo diretório `prisma/tenant-migrations/` em `BANCO-DE-DADOS.md`.

- [ ] **Step 5: Commit e lembrete de push**

```bash
git add CLAUDE.md
git commit -m "docs: document schema-per-tenant Phase 1 (physical isolation, TenantMigrationManager)"
git status -sb
```

Reportar o número de commits à frente de `origin/main` e perguntar ao usuário se deseja fazer push agora (instrução permanente desta sessão: sempre lembrar de subir pro GitHub ao final de uma feature).
