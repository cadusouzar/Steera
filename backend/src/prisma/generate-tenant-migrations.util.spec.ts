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
