-- DropIndex
DROP INDEX "TimeTrackingSettings_companyId_key";

-- AlterTable
ALTER TABLE "TimeTrackingSettings" ADD COLUMN     "managerId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hasFullPontoAccess" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "WorkSchedule" ADD COLUMN     "managerId" TEXT,
ALTER COLUMN "employeeId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "TimeTrackingSettings_companyId_idx" ON "TimeTrackingSettings"("companyId");

-- CreateIndex
CREATE INDEX "TimeTrackingSettings_managerId_idx" ON "TimeTrackingSettings"("managerId");

-- CreateIndex
CREATE INDEX "WorkSchedule_managerId_idx" ON "WorkSchedule"("managerId");

-- AddForeignKey
ALTER TABLE "TimeTrackingSettings" ADD CONSTRAINT "TimeTrackingSettings_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes: a plain @@unique([companyId, managerId]) would not work here because
-- Postgres treats NULL as never equal to itself, so multiple managerId:NULL rows for the same
-- company would NOT violate it. These two indexes replace the old bare `companyId @unique`.
CREATE UNIQUE INDEX "TimeTrackingSettings_company_default_key"
  ON "TimeTrackingSettings" ("companyId") WHERE "managerId" IS NULL;
CREATE UNIQUE INDEX "TimeTrackingSettings_manager_override_key"
  ON "TimeTrackingSettings" ("companyId", "managerId") WHERE "managerId" IS NOT NULL;

