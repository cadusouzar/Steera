-- CreateEnum
CREATE TYPE "VacationScheduleStatus" AS ENUM ('SCHEDULED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "VacationSchedule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "acquisitivePeriodStart" DATE NOT NULL,
    "acquisitivePeriodEnd" DATE NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "daysCount" INTEGER NOT NULL,
    "status" "VacationScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacationSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VacationSchedule_companyId_idx" ON "VacationSchedule"("companyId");

-- CreateIndex
CREATE INDEX "VacationSchedule_employeeId_idx" ON "VacationSchedule"("employeeId");

-- CreateIndex
CREATE INDEX "VacationSchedule_status_idx" ON "VacationSchedule"("status");

-- AddForeignKey
ALTER TABLE "VacationSchedule" ADD CONSTRAINT "VacationSchedule_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
