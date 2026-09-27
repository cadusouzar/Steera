import { existsSync } from 'fs';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  CENTRAL_ONLY_ENUM_NAMES,
  CENTRAL_ONLY_FUNCTION_NAMES,
  CENTRAL_ONLY_VIEW_NAMES,
  NOOP_WHEN_REPLAYED_FROM_EMPTY,
  splitMigrationSqlByTenant,
} from '../../scripts/generate-tenant-migrations';

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

  // 27/09/2026 (backfill de `assinatura.gerenciar`): primeira migration de dados com INSERT deste
  // projeto. Sem classificador, os INSERTs em "Permission"/"ProfilePermission" (centrais) caíam no
  // branch "desconhecido, mantém com aviso" e iam parar na réplica de TENANT — seriam reexecutados
  // em cada schema de empresa pelo TenantMigrationManagerService.
  it('mantém INSERT INTO numa tabela de tenant e remove numa tabela central', () => {
    const sql = [
      `INSERT INTO "Client" ("id") VALUES ('x');`,
      `INSERT INTO "Permission" ("code") VALUES ('a.b') ON CONFLICT ("code") DO NOTHING;`,
      'INSERT INTO "ProfilePermission" ("id") SELECT gen_random_uuid()::text FROM "ProfilePermission" pp ON CONFLICT DO NOTHING;',
    ].join('\n\n');
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).toContain('INSERT INTO "Client"');
    expect(result).not.toContain('INSERT INTO "Permission"');
    expect(result).not.toContain('INSERT INTO "ProfilePermission"');
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

  // Achado em 17/09/2026 ao gerar a migration que adiciona valores a AppModule/UserStatus (ambos
  // usados só por `User`, uma tabela central): ALTER TYPE não batia em nenhum padrão anterior, caía
  // no branch "mantém por segurança" — só que, ao contrário de CREATE TYPE, manter um ALTER TYPE
  // faria toda empresa nova depois da primeira tentar adicionar o MESMO valor de novo no MESMO tipo
  // global, quebrando com "enum label already exists".
  it('remove ALTER TYPE de um enum central (sem aviso — classificado, não é o caso "desconhecido")', () => {
    const sql = 'ALTER TYPE "AppModule" ADD VALUE \'RH_CARGOS\';';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).not.toContain('AppModule');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('mantém ALTER TYPE de um enum que não está na lista de enums centrais conhecidos', () => {
    const sql = 'ALTER TYPE "ClientStatus" ADD VALUE \'ARCHIVED\';';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).toContain('ClientStatus');
  });

  // Achado em 26/09/2026 ao gerar a migration que adiciona GRATIS a CompanyPlanTier (usado só por
  // `Company`, tabela central) — mesmo padrão de AppModule/UserStatus acima: sem isso, a segunda
  // empresa provisionada em diante quebraria com "enum label already exists".
  it('remove ALTER TYPE de CompanyPlanTier (sem aviso — classificado, não é o caso "desconhecido")', () => {
    const sql = 'ALTER TYPE "CompanyPlanTier" ADD VALUE IF NOT EXISTS \'GRATIS\' BEFORE \'BASICO\';';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).not.toContain('CompanyPlanTier');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Achado em 17/09/2026 investigando um admin real vendo "sem acesso ao módulo": a migration de
  // backfill dos módulos granulares tinha `SELECT set_config('app.rls_bypass', ...)` antes dos
  // UPDATEs em "User" (tabela central com FORCE RLS) — sem esse classificador, o comando caía no
  // branch "desconhecido, mantém com aviso", e replayar essa linha sozinha (sem os UPDATEs, já
  // removidos por serem de tabela central) num schema de tenant novo é um no-op inofensivo, mas
  // gerava aviso à toa toda vez que qualquer migration futura precisasse do mesmo bypass.
  it('remove SELECT set_config de bypass de RLS (sem aviso — sempre setup de tabela central)', () => {
    const sql = "SELECT set_config('app.rls_bypass', 'on', true);";
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result.trim()).toBe('');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Achado em 25/09/2026 (Task 3 do plano de cadastro-ampliado-e-schema-legivel): `tenant_directory`
  // é uma VIEW central (lê "Company"/"User", nenhuma tabela de tenant) que a migration original
  // criou junto de `Company.schemaName`. `CREATE VIEW`/`DROP VIEW` não batiam em nenhum padrão do
  // classificador acima, então caíam no branch "desconhecido, mantém com aviso" — replayada dentro
  // de um schema de tenant (search_path `tenant_x, public`), a view resolveria "Company"/"User" via
  // fallthrough pro schema `public` normalmente, então cada empresa ganharia sua PRÓPRIA cópia da
  // MESMA view listando TODAS as empresas do sistema ("Company" não tem RLS) — o oposto do que a
  // view existe pra fazer (um diretório único, central, pro N1/dev). Mesmo padrão de
  // `CENTRAL_ONLY_ENUM_NAMES`: lista manual, porque o gerador só processa texto SQL, sem saber quais
  // views são central-only.
  it('remove CREATE VIEW de uma view central-only (tenant_directory) — sem aviso', () => {
    const sql = 'CREATE VIEW "tenant_directory" AS\nSELECT c."name" AS empresa\nFROM "Company" c;';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result.trim()).toBe('');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('remove CREATE OR REPLACE VIEW de uma view central-only — sem aviso', () => {
    const sql = 'CREATE OR REPLACE VIEW "tenant_directory" AS\nSELECT c."name" AS empresa\nFROM "Company" c;';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result.trim()).toBe('');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('remove DROP VIEW de uma view central-only — sem aviso', () => {
    const sql = 'DROP VIEW IF EXISTS "tenant_directory";';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result.trim()).toBe('');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('remove DROP VIEW (sem IF EXISTS) de uma view central-only — sem aviso', () => {
    const sql = 'DROP VIEW "tenant_directory";';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result.trim()).toBe('');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('mantém CREATE TYPE "CompanyPersonType" na mesma migration que também cria a view tenant_directory', () => {
    const sql = [
      'CREATE TYPE "CompanyPersonType" AS ENUM (\'PJ\', \'PF\');',
      'CREATE VIEW "tenant_directory" AS\nSELECT c."name" AS empresa\nFROM "Company" c;',
    ].join('\n\n');
    const result = splitMigrationSqlByTenant(sql, TENANT_TABLES);
    expect(result).toContain('CREATE TYPE "CompanyPersonType"');
    expect(result).not.toContain('tenant_directory');
  });

  it('mantém CREATE VIEW de uma view que não está na lista de views centrais conhecidas', () => {
    const sql = 'CREATE VIEW "algum_relatorio" AS\nSELECT 1;';
    expect(splitMigrationSqlByTenant(sql, TENANT_TABLES)).toContain('algum_relatorio');
  });
});

// Revisão final do cadastro ampliado (25/09/2026): a migration que liga security_invoker na
// tenant_directory e cria a trigger de imutabilidade de Company.schemaName só toca objetos
// CENTRAIS — nada dela pode ir pra prisma/tenant-migrations/. O corpo plpgsql ($$ ... $$) tem `;`
// seguido de quebra de linha: o splitter antigo (que dividia em todo `;` + quebra de linha) cortava
// a função em pedaços, e cada pedaço caía no branch "não classificado, mantido por padrão" — SQL
// quebrado replicado em cada schema de tenant novo.
describe('splitMigrationSqlByTenant — funções, triggers e blocos $$', () => {
  const functionSql = [
    'CREATE FUNCTION company_schema_name_immutable() RETURNS trigger',
    'LANGUAGE plpgsql AS $$',
    'BEGIN',
    '  IF NEW."schemaName" IS DISTINCT FROM OLD."schemaName" THEN',
    "    RAISE EXCEPTION 'não pode';",
    '  END IF;',
    '  RETURN NEW;',
    'END;',
    '$$;',
  ].join('\n');

  const silently = (fn: () => string) => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      return { result: fn(), warned: warnSpy.mock.calls.length > 0 };
    } finally {
      warnSpy.mockRestore();
    }
  };

  it('remove ALTER VIEW de uma view central-only — sem aviso', () => {
    const { result, warned } = silently(() =>
      splitMigrationSqlByTenant('ALTER VIEW "tenant_directory" SET (security_invoker = true);', TENANT_TABLES),
    );
    expect(result.trim()).toBe('');
    expect(warned).toBe(false);
  });

  it('remove por inteiro uma CREATE FUNCTION central-only com corpo $$ multi-statement — sem aviso nem pedaços', () => {
    const { result, warned } = silently(() => splitMigrationSqlByTenant(functionSql, TENANT_TABLES));
    expect(result.trim()).toBe('');
    expect(warned).toBe(false);
  });

  it('mantém inteira (um único statement) uma função não listada, sem partir o corpo $$', () => {
    const sql = functionSql.replace(/company_schema_name_immutable/g, 'outra_funcao');
    const { result } = silently(() => splitMigrationSqlByTenant(sql, TENANT_TABLES));
    expect(result).toBe(sql);
  });

  it('não parte blocos com tag ($body$ ... $body$)', () => {
    const sql = [
      'CREATE OR REPLACE FUNCTION "outra"() RETURNS void LANGUAGE plpgsql AS $body$',
      'BEGIN',
      '  PERFORM 1;',
      'END;',
      '$body$;',
    ].join('\n');
    const { result } = silently(() => splitMigrationSqlByTenant(sql, TENANT_TABLES));
    expect(result).toBe(sql);
  });

  it('remove CREATE TRIGGER numa tabela central e mantém numa tabela de tenant', () => {
    const central = [
      'CREATE TRIGGER company_schema_name_immutable',
      'BEFORE UPDATE OF "schemaName" ON "Company"',
      'FOR EACH ROW EXECUTE FUNCTION company_schema_name_immutable();',
    ].join('\n');
    const tenant = ['CREATE TRIGGER algum_gatilho', 'BEFORE UPDATE ON "Client"', 'FOR EACH ROW EXECUTE FUNCTION outra();'].join('\n');
    const { result, warned } = silently(() => splitMigrationSqlByTenant(`${central}\n\n${tenant}`, TENANT_TABLES));
    expect(result).toBe(tenant);
    expect(warned).toBe(false);
  });

  it('a migration real 20260925150000 não gera nada pra tenant', () => {
    const sql = readFileSync(
      join(
        __dirname, '..', '..', 'prisma', 'migrations',
        '20260925150000_tenant_directory_invoker_and_immutable_schema_name', 'migration.sql',
      ),
      'utf8',
    );
    const { result, warned } = silently(() => splitMigrationSqlByTenant(sql, TENANT_TABLES));
    expect(result.trim()).toBe('');
    expect(warned).toBe(false);
  });
});

describe('CENTRAL_ONLY_FUNCTION_NAMES', () => {
  it('contém company_schema_name_immutable, a única função central-only conhecida hoje', () => {
    expect(CENTRAL_ONLY_FUNCTION_NAMES).toEqual(['company_schema_name_immutable']);
  });
});

describe('CENTRAL_ONLY_VIEW_NAMES', () => {
  it('contém tenant_directory, a única view central-only conhecida hoje', () => {
    expect(CENTRAL_ONLY_VIEW_NAMES).toEqual(['tenant_directory']);
  });
});

describe('CENTRAL_ONLY_ENUM_NAMES', () => {
  it('contém AppModule, UserStatus, CompanyPlanTier e UserTokenType, os enums usados só por tabelas centrais hoje', () => {
    expect(CENTRAL_ONLY_ENUM_NAMES).toEqual(['AppModule', 'UserStatus', 'CompanyPlanTier', 'UserTokenType']);
  });
});

// Regressão: 20260911003303_restore_client_trash_columns e
// 20260911003700_restore_receivable_subscription_link são migrations de REMEDIAÇÃO de um
// incidente real no banco de dev compartilhado (um `db push --accept-data-loss` apagou colunas que
// uma migration ANTERIOR na mesma sequência já tinha criado). Cada uma re-adiciona algo que já
// existe desde uma migration mais antiga — redundante (e um erro real de "coluna já existe") quando
// replicada do zero contra um schema de tenant novo, que nunca sofreu o incidente. Descoberto ao
// rodar o replay completo do histórico de tenant contra um schema descartável (Task 4).
describe('NOOP_WHEN_REPLAYED_FROM_EMPTY', () => {
  it('contém exatamente as duas migrations de remediação de incidente conhecidas', () => {
    expect(NOOP_WHEN_REPLAYED_FROM_EMPTY).toEqual([
      '20260911003303_restore_client_trash_columns',
      '20260911003700_restore_receivable_subscription_link',
    ]);
  });

  it('não gera pasta em prisma/tenant-migrations/ pra nenhuma das duas migrations de remediação', () => {
    const tenantMigrationsDir = join(__dirname, '..', '..', 'prisma', 'tenant-migrations');
    for (const name of NOOP_WHEN_REPLAYED_FROM_EMPTY) {
      expect(existsSync(join(tenantMigrationsDir, name))).toBe(false);
    }
  });
});
