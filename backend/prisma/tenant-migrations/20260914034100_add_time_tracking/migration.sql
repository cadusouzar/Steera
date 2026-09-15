CREATE TYPE "TimeEventType" AS ENUM ('CLOCK_IN', 'BREAK_START', 'BREAK_END', 'CLOCK_OUT', 'EXTRA_IN', 'EXTRA_OUT');

CREATE TYPE "TimeEventSource" AS ENUM ('WEB', 'MOBILE', 'ADMIN_MANUAL');

CREATE TYPE "TimeEventValidationStatus" AS ENUM ('VALID', 'PENDING_REVIEW', 'CORRECTED');

CREATE TYPE "LocationStatus" AS ENUM ('WITHIN_RANGE', 'OUT_OF_RANGE', 'IMPRECISE', 'UNAVAILABLE', 'NOT_REQUIRED');

CREATE TYPE "TimeAdjustmentType" AS ENUM ('ADD_MISSING_PUNCH', 'CORRECT_TIME', 'REMOVE_PUNCH');

CREATE TYPE "TimeAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TYPE "JustificationType" AS ENUM ('ABSENCE', 'INCOMPLETE_DAY', 'ADJUSTMENT_SUPPORT', 'MEDICAL_CERTIFICATE', 'OTHER');

CREATE TYPE "JustificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TYPE "FileAssetPurpose" AS ENUM ('TIME_PUNCH_PHOTO', 'ADJUSTMENT_ATTACHMENT', 'JUSTIFICATION_ATTACHMENT');

CREATE TYPE "HolidayScope" AS ENUM ('NATIONAL', 'STATE', 'COMPANY');

ALTER TABLE "Employee" ADD COLUMN     "managerId" TEXT;

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

CREATE UNIQUE INDEX "TimeTrackingSettings_companyId_key" ON "TimeTrackingSettings"("companyId");

CREATE INDEX "TimeEvent_companyId_idx" ON "TimeEvent"("companyId");

CREATE INDEX "TimeEvent_employeeId_idx" ON "TimeEvent"("employeeId");

CREATE INDEX "TimeEvent_employeeId_serverRecordedAt_idx" ON "TimeEvent"("employeeId", "serverRecordedAt");

CREATE INDEX "TimeEvent_validationStatus_idx" ON "TimeEvent"("validationStatus");

CREATE INDEX "WorkSchedule_companyId_idx" ON "WorkSchedule"("companyId");

CREATE INDEX "WorkSchedule_employeeId_idx" ON "WorkSchedule"("employeeId");

CREATE INDEX "WorkSchedule_employeeId_validFrom_idx" ON "WorkSchedule"("employeeId", "validFrom");

CREATE INDEX "WorkLocation_companyId_idx" ON "WorkLocation"("companyId");

CREATE INDEX "TimeAdjustmentRequest_companyId_idx" ON "TimeAdjustmentRequest"("companyId");

CREATE INDEX "TimeAdjustmentRequest_employeeId_idx" ON "TimeAdjustmentRequest"("employeeId");

CREATE INDEX "TimeAdjustmentRequest_status_idx" ON "TimeAdjustmentRequest"("status");

CREATE UNIQUE INDEX "TimeCorrection_adjustmentRequestId_key" ON "TimeCorrection"("adjustmentRequestId");

CREATE INDEX "TimeCorrection_companyId_idx" ON "TimeCorrection"("companyId");

CREATE INDEX "TimeJustification_companyId_idx" ON "TimeJustification"("companyId");

CREATE INDEX "TimeJustification_employeeId_idx" ON "TimeJustification"("employeeId");

CREATE INDEX "TimeJustification_status_idx" ON "TimeJustification"("status");

CREATE INDEX "FileAsset_companyId_idx" ON "FileAsset"("companyId");

CREATE INDEX "Employee_managerId_idx" ON "Employee"("managerId");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimeTrackingSettings" ADD CONSTRAINT "TimeTrackingSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimeEvent" ADD CONSTRAINT "TimeEvent_photoAssetId_fkey" FOREIGN KEY ("photoAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkLocation" ADD CONSTRAINT "WorkLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_relatedEventId_fkey" FOREIGN KEY ("relatedEventId") REFERENCES "TimeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimeAdjustmentRequest" ADD CONSTRAINT "TimeAdjustmentRequest_attachmentAssetId_fkey" FOREIGN KEY ("attachmentAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_adjustmentRequestId_fkey" FOREIGN KEY ("adjustmentRequestId") REFERENCES "TimeAdjustmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_originalEventId_fkey" FOREIGN KEY ("originalEventId") REFERENCES "TimeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimeCorrection" ADD CONSTRAINT "TimeCorrection_correctedEventId_fkey" FOREIGN KEY ("correctedEventId") REFERENCES "TimeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeJustification" ADD CONSTRAINT "TimeJustification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeJustification" ADD CONSTRAINT "TimeJustification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeJustification" ADD CONSTRAINT "TimeJustification_attachmentAssetId_fkey" FOREIGN KEY ("attachmentAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
