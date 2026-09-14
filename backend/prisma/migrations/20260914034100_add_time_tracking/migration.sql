-- CreateEnum
CREATE TYPE "TimeEventType" AS ENUM ('CLOCK_IN', 'BREAK_START', 'BREAK_END', 'CLOCK_OUT', 'EXTRA_IN', 'EXTRA_OUT');

-- CreateEnum
CREATE TYPE "TimeEventSource" AS ENUM ('WEB', 'MOBILE', 'ADMIN_MANUAL');

-- CreateEnum
CREATE TYPE "TimeEventValidationStatus" AS ENUM ('VALID', 'PENDING_REVIEW', 'CORRECTED');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('WITHIN_RANGE', 'OUT_OF_RANGE', 'IMPRECISE', 'UNAVAILABLE', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "TimeAdjustmentType" AS ENUM ('ADD_MISSING_PUNCH', 'CORRECT_TIME', 'REMOVE_PUNCH');

-- CreateEnum
CREATE TYPE "TimeAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JustificationType" AS ENUM ('ABSENCE', 'INCOMPLETE_DAY', 'ADJUSTMENT_SUPPORT', 'MEDICAL_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "JustificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FileAssetPurpose" AS ENUM ('TIME_PUNCH_PHOTO', 'ADJUSTMENT_ATTACHMENT', 'JUSTIFICATION_ATTACHMENT');

-- CreateEnum
CREATE TYPE "HolidayScope" AS ENUM ('NATIONAL', 'STATE', 'COMPANY');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "state" CHAR(2),
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "managerId" TEXT;

-- CreateTable
CREATE TABLE "TimeTrackingSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requirePhoto" BOOLEAN NOT NULL DEFAULT true,
    "requireLocation" BOOLEAN NOT NULL DEFAULT true,
    "allowLocationException" BOOLEAN NOT NULL DEFAULT false,
    "allowExtraPeriods" BOOLEAN NOT NULL DEFAULT true,
    "maxAttachmentSizeBytes" INTEGER NOT NULL DEFAULT 5242880,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeTrackingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "TimeEventType" NOT NULL,
    "source" "TimeEventSource" NOT NULL DEFAULT 'WEB',
    "serverRecordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceReportedAt" TIMESTAMP(3),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "accuracyMeters" DECIMAL(8,2),
    "locationStatus" "LocationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "workLocationId" TEXT,
    "photoAssetId" TEXT,
    "validationStatus" "TimeEventValidationStatus" NOT NULL DEFAULT 'VALID',
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weekDays" INTEGER[],
    "expectedStartTime" TEXT NOT NULL,
    "expectedEndTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "dailyMinutes" INTEGER NOT NULL,
    "weeklyMinutes" INTEGER NOT NULL,
    "toleranceMinutes" INTEGER NOT NULL DEFAULT 0,
    "allowOvertime" BOOLEAN NOT NULL DEFAULT false,
    "maxOvertimeMinutesPerDay" INTEGER,
    "nightShift" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLocation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "targetDate" DATE NOT NULL,
    "relatedEventId" TEXT,
    "type" "TimeAdjustmentType" NOT NULL,
    "requestedEventType" "TimeEventType",
    "requestedTime" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "justification" TEXT,
    "attachmentAssetId" TEXT,
    "status" "TimeAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeCorrection" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "adjustmentRequestId" TEXT NOT NULL,
    "originalEventId" TEXT,
    "originalValue" JSONB,
    "correctedEventId" TEXT NOT NULL,
    "correctedValue" JSONB NOT NULL,
    "requestedByEmployeeId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeJustification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "relatedDate" DATE,
    "periodStart" DATE,
    "periodEnd" DATE,
    "type" "JustificationType" NOT NULL,
    "description" TEXT NOT NULL,
    "attachmentAssetId" TEXT,
    "status" "JustificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeJustification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "purpose" "FileAssetPurpose" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "scope" "HolidayScope" NOT NULL,
    "state" CHAR(2),
    "companyId" TEXT,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeTrackingSettings_companyId_key" ON "TimeTrackingSettings"("companyId");

-- CreateIndex
CREATE INDEX "TimeEvent_companyId_idx" ON "TimeEvent"("companyId");

-- CreateIndex
CREATE INDEX "TimeEvent_employeeId_idx" ON "TimeEvent"("employeeId");

-- CreateIndex
CREATE INDEX "TimeEvent_employeeId_serverRecordedAt_idx" ON "TimeEvent"("employeeId", "serverRecordedAt");

-- CreateIndex
CREATE INDEX "TimeEvent_validationStatus_idx" ON "TimeEvent"("validationStatus");

-- CreateIndex
CREATE INDEX "WorkSchedule_companyId_idx" ON "WorkSchedule"("companyId");

-- CreateIndex
CREATE INDEX "WorkSchedule_employeeId_idx" ON "WorkSchedule"("employeeId");

-- CreateIndex
CREATE INDEX "WorkSchedule_employeeId_validFrom_idx" ON "WorkSchedule"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "WorkLocation_companyId_idx" ON "WorkLocation"("companyId");

-- CreateIndex
CREATE INDEX "TimeAdjustmentRequest_companyId_idx" ON "TimeAdjustmentRequest"("companyId");

-- CreateIndex
CREATE INDEX "TimeAdjustmentRequest_employeeId_idx" ON "TimeAdjustmentRequest"("employeeId");

-- CreateIndex
CREATE INDEX "TimeAdjustmentRequest_status_idx" ON "TimeAdjustmentRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TimeCorrection_adjustmentRequestId_key" ON "TimeCorrection"("adjustmentRequestId");

-- CreateIndex
CREATE INDEX "TimeCorrection_companyId_idx" ON "TimeCorrection"("companyId");

-- CreateIndex
CREATE INDEX "TimeJustification_companyId_idx" ON "TimeJustification"("companyId");

-- CreateIndex
CREATE INDEX "TimeJustification_employeeId_idx" ON "TimeJustification"("employeeId");

-- CreateIndex
CREATE INDEX "TimeJustification_status_idx" ON "TimeJustification"("status");

-- CreateIndex
CREATE INDEX "FileAsset_companyId_idx" ON "FileAsset"("companyId");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Holiday_companyId_idx" ON "Holiday"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_scope_state_companyId_date_key" ON "Holiday"("scope", "state", "companyId", "date");

-- CreateIndex
CREATE INDEX "Employee_managerId_idx" ON "Employee"("managerId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeTrackingSettings" ADD CONSTRAINT "TimeTrackingSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_relatedEventId_fkey" FOREIGN KEY ("relatedEventId") REFERENCES "TimeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_attachmentAssetId_fkey" FOREIGN KEY ("attachmentAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_adjustmentRequestId_fkey" FOREIGN KEY ("adjustmentRequestId") REFERENCES "TimeAdjustmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_originalEventId_fkey" FOREIGN KEY ("originalEventId") REFERENCES "TimeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_correctedEventId_fkey" FOREIGN KEY ("correctedEventId") REFERENCES "TimeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeJustification" ADD CONSTRAINT "TimeJustification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeJustification" ADD CONSTRAINT "TimeJustification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeJustification" ADD CONSTRAINT "TimeJustification_attachmentAssetId_fkey" FOREIGN KEY ("attachmentAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security for the new Time Tracking tables — same backstop already
-- applied to every other tenant table in this project (see
-- prisma/migrations/20260913140100_enable_row_level_security/migration.sql
-- for the full rationale: FORCE is required because Postgres otherwise
-- exempts the table owner — this project's own app DB user — from every
-- policy; current_setting(key, true) returns NULL instead of raising when no
-- tenant context is set, which correctly denies all rows/writes by default;
-- the `app.rls_bypass` OR-clause is the same narrow escape hatch used
-- elsewhere for pre-authentication code paths, kept here purely so every
-- RLS-protected table in the database shares one policy shape — none of
-- these 9 tables are touched by any pre-auth call site today).
--
-- All 9 new tables with a companyId column get the standard policy.
-- Holiday is the one exception: scope=NATIONAL/STATE rows have a NULL
-- companyId and must stay globally visible/writable-by-nobody-in-particular,
-- so its USING/WITH CHECK treat "companyId" IS NULL as "visible to every
-- tenant" in addition to the normal tenant match.

ALTER TABLE "TimeEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeEvent"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "WorkSchedule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkSchedule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkSchedule"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "WorkLocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkLocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "WorkLocation"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "TimeAdjustmentRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeAdjustmentRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeAdjustmentRequest"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "TimeCorrection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeCorrection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeCorrection"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "TimeJustification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeJustification" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeJustification"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "FileAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FileAsset" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FileAsset"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "TimeTrackingSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeTrackingSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TimeTrackingSettings"
  USING ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Holiday" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Holiday"
  USING ("companyId" IS NULL OR "companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("companyId" IS NULL OR "companyId" = current_setting('app.current_company_id', true) OR current_setting('app.rls_bypass', true) = 'on');

