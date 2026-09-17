import { existsSync } from 'fs';
import { join } from 'path';
import { CENTRAL_ONLY_ENUM_NAMES, NOOP_WHEN_REPLAYED_FROM_EMPTY, splitMigrationSqlByTenant } from '../../scripts/generate-tenant-migrations';

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
});

describe('CENTRAL_ONLY_ENUM_NAMES', () => {
  it('contém AppModule e UserStatus, os dois únicos enums usados só por User hoje', () => {
    expect(CENTRAL_ONLY_ENUM_NAMES).toEqual(['AppModule', 'UserStatus']);
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
