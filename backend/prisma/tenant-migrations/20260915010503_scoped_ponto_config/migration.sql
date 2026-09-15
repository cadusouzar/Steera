DROP INDEX "TimeTrackingSettings_companyId_key";

ALTER TABLE "TimeTrackingSettings" ADD COLUMN     "managerId" TEXT;

ALTER TABLE "WorkSchedule" ADD COLUMN     "managerId" TEXT,
ALTER COLUMN "employeeId" DROP NOT NULL;

CREATE INDEX "TimeTrackingSettings_companyId_idx" ON "TimeTrackingSettings"("companyId");

CREATE INDEX "TimeTrackingSettings_managerId_idx" ON "TimeTrackingSettings"("managerId");

CREATE INDEX "WorkSchedule_managerId_idx" ON "WorkSchedule"("managerId");

ALTER TABLE "TimeTrackingSettings" ADD CONSTRAINT "TimeTrackingSettings_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TimeTrackingSettings_company_default_key"
  ON "TimeTrackingSettings" ("companyId") WHERE "managerId" IS NULL;

CREATE UNIQUE INDEX "TimeTrackingSettings_manager_override_key"
  ON "TimeTrackingSettings" ("companyId", "managerId") WHERE "managerId" IS NOT NULL;
