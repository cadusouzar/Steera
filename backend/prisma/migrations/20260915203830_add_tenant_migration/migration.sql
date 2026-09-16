-- CreateTable
CREATE TABLE "TenantMigration" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "migrationName" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMigration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantMigration_companyId_idx" ON "TenantMigration"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMigration_companyId_migrationName_key" ON "TenantMigration"("companyId", "migrationName");

-- AddForeignKey
ALTER TABLE "TenantMigration" ADD CONSTRAINT "TenantMigration_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

