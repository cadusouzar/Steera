-- CreateEnum
CREATE TYPE "CompanyPersonType" AS ENUM ('PJ', 'PF');

-- AlterTable: dados cadastrais (nullable — empresas antigas não têm) + schemaName (nullable até o backfill)
ALTER TABLE "Company"
  ADD COLUMN "personType" "CompanyPersonType",
  ADD COLUMN "document" TEXT,
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "tradeName" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "zipCode" TEXT,
  ADD COLUMN "street" TEXT,
  ADD COLUMN "number" TEXT,
  ADD COLUMN "complement" TEXT,
  ADD COLUMN "district" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "schemaName" TEXT;

-- Backfill: empresas existentes registram o nome que JÁ usam hoje — nenhum schema é renomeado.
UPDATE "Company" SET "schemaName" = 'tenant_' || "id" WHERE "schemaName" IS NULL;

ALTER TABLE "Company" ALTER COLUMN "schemaName" SET NOT NULL;

CREATE UNIQUE INDEX "Company_document_key" ON "Company"("document");
CREATE UNIQUE INDEX "Company_schemaName_key" ON "Company"("schemaName");

-- AlterTable
ALTER TABLE "User" ADD COLUMN "name" TEXT;

-- Diretório pro N1/dev achar qualquer empresa pelo banco (spec 2026-09-25, Parte E). Só leitura,
-- sem dados próprios; nenhuma rota HTTP expõe isto (contém e-mail = dado pessoal). "User" tem
-- FORCE ROW LEVEL SECURITY: como quickflow_app, consultar dentro de uma transação com
-- set_config('app.rls_bypass','on',true); como superusuário funciona direto.
CREATE VIEW "tenant_directory" AS
SELECT
  c."name"       AS empresa,
  c."legalName"  AS razao_social,
  c."document"   AS documento,
  c."schemaName" AS schema,
  (
    SELECT u."email" FROM "User" u
    WHERE u."companyId" = c."id" AND u."role" = 'ADMIN'
    ORDER BY u."createdAt" ASC
    LIMIT 1
  )              AS email_admin,
  c."planTier"   AS plano,
  c."createdAt"  AS criada_em
FROM "Company" c;
