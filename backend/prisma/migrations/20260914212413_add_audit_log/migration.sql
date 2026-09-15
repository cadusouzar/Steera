-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PUNCH_DUPLICATE_REJECTED', 'PUNCH_VALIDATION_REJECTED', 'FILE_ACCESSED');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "employeeId" TEXT,
    "performedByUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_employeeId_idx" ON "AuditLog"("companyId", "employeeId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: mesmo padrão de tenant_isolation aplicado a toda tabela companyId deste módulo
-- (ver 20260914034100_add_time_tracking/migration.sql) — FORCE inclusive pro dono da conexão.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

