CREATE TYPE "AuditAction" AS ENUM ('PUNCH_DUPLICATE_REJECTED', 'PUNCH_VALIDATION_REJECTED', 'FILE_ACCESSED');

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

CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

CREATE INDEX "AuditLog_companyId_employeeId_idx" ON "AuditLog"("companyId", "employeeId");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');
