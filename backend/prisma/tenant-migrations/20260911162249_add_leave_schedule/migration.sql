CREATE TYPE "LeaveScheduleStatus" AS ENUM ('SCHEDULED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "LeaveSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "daysCount" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "LeaveScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LeaveSchedule_companyId_idx" ON "LeaveSchedule"("companyId");

CREATE INDEX "LeaveSchedule_employeeId_idx" ON "LeaveSchedule"("employeeId");

CREATE INDEX "LeaveSchedule_status_idx" ON "LeaveSchedule"("status");

ALTER TABLE "LeaveSchedule" ADD CONSTRAINT "LeaveSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
